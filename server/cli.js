#!/usr/bin/env node
// Gerenciamento de usuários pelo terminal do servidor.
//   node server/cli.js criar-admin  <email> "<nome>"
//   node server/cli.js criar-equipe <email> "<nome>"
//   node server/cli.js redefinir-senha <email>
//   node server/cli.js desativar <email>   |   ativar <email>
//   node server/cli.js listar
//   node server/cli.js marca aplicar marcas/arquivo.json
//   node server/cli.js marca exportar [arquivo.json]
//   node server/cli.js marca logo caminho/logo.png
import { readFile, writeFile } from 'node:fs/promises'
import { extname, resolve, dirname } from 'node:path'
import { lerConfig } from './config.js'
import { criarPool, migrar } from './db.js'
import { gerarHash, gerarSenhaTemporaria } from './senha.js'
import { carregarMarca, conferirImagem, salvarLogo, salvarMarca } from './marca.js'
import { ativarLicenca, gerarHashChave, situacaoLicenca } from './licenca.js'

const TIPO_POR_EXTENSAO = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' }

async function aplicarLogo(pool, caminho) {
  const tipo = TIPO_POR_EXTENSAO[extname(caminho).toLowerCase()]
  const buffer = await readFile(caminho)
  if (!tipo || !conferirImagem(buffer, tipo)) throw new Error(`Logo inválida (PNG, JPG, WEBP ou SVG até 1 MB): ${caminho}`)
  await salvarLogo(pool, buffer, tipo)
  console.log(`Logo aplicada: ${caminho}`)
}

const [comando, emailBruto, ...resto] = process.argv.slice(2)
const args = process.argv.slice(3)
const email = emailBruto?.trim().toLowerCase()
const nome = resto.join(' ').trim()

const AJUDA = `Uso:
  node server/cli.js criar-admin  <email> "<nome>"   cria um administrador
  node server/cli.js criar-equipe <email> "<nome>"   cria um usuário da equipe
  node server/cli.js criar-coordenador <email> "<nome>"  cria um coordenador de núcleo
                                                     (associe os núcleos dele pelo painel)
  node server/cli.js redefinir-senha <email>         gera nova senha temporária
                                                     (e desliga a verificação em duas etapas)
  node server/cli.js desativar <email>               bloqueia o acesso
  node server/cli.js ativar <email>                  libera o acesso
  node server/cli.js listar                          lista os usuários

  node server/cli.js marca aplicar <arquivo.json>    aplica nome, cores, textos e tribos
                                                     (e a logo, se o arquivo indicar "logo")
  node server/cli.js marca exportar [arquivo.json]   salva a marca atual em um arquivo
  node server/cli.js marca logo <imagem>             troca só a logo (PNG, JPG, WEBP ou SVG)

  node server/cli.js licenca ativar <CHAVE>          ativa o sistema com a chave de ativação
  node server/cli.js licenca status                  mostra se o sistema está ativado`

// Gerar o hash de uma chave nova não precisa de banco de dados.
// Cole a linha gerada em CHAVES_LICENCA (server/licenca.js). A chave em si nunca deve ser publicada.
if (comando === 'licenca' && args[0] === 'gerar-hash') {
  if (!args[1]) { console.error('Informe a chave: node server/cli.js licenca gerar-hash XXX-0000'); process.exit(1) }
  try {
    const { sal, hash } = await gerarHashChave(args[1])
    console.log(`  { id: 'k${Date.now().toString(36)}', sal: '${sal}', hash: '${hash}' },`)
    process.exit(0)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}

const pool = criarPool(lerConfig().databaseUrl)
const silencioso = { info: () => {} }

try {
  await migrar(pool, silencioso)
  switch (comando) {
    case 'criar-admin':
    case 'criar-equipe':
    case 'criar-coordenador': {
      if (!email || !nome) throw new Error(AJUDA)
      const senha = gerarSenhaTemporaria()
      await pool.query(
        'insert into usuarios (email, nome, papel, senha_hash, trocar_senha) values ($1, $2, $3, $4, true)',
        [email, nome, comando.replace('criar-', ''), await gerarHash(senha)])
      console.log(`Usuário criado: ${email}\nSenha temporária: ${senha}\n(será pedida uma nova senha no primeiro acesso)`)
      break
    }
    case 'redefinir-senha': {
      const senha = gerarSenhaTemporaria()
      const r = await pool.query(`update usuarios set senha_hash = $1, trocar_senha = true,
          totp_ativo = false, totp_segredo = null, totp_ultimo_passo = null where email = $2 returning id`,
        [await gerarHash(senha), email])
      if (!r.rowCount) throw new Error(`Usuário não encontrado: ${email}`)
      await pool.query('delete from sessoes where usuario_id = $1', [r.rows[0].id])
      console.log(`Nova senha temporária de ${email}: ${senha}`)
      break
    }
    case 'desativar':
    case 'ativar': {
      const r = await pool.query('update usuarios set ativo = $1 where email = $2 returning id', [comando === 'ativar', email])
      if (!r.rowCount) throw new Error(`Usuário não encontrado: ${email}`)
      if (comando === 'desativar') await pool.query('delete from sessoes where usuario_id = $1', [r.rows[0].id])
      console.log(`Usuário ${email} ${comando === 'ativar' ? 'ativado' : 'desativado'}.`)
      break
    }
    case 'listar': {
      const { rows } = await pool.query('select email, nome, papel, ativo, ultimo_login from usuarios order by nome')
      console.table(rows)
      break
    }
    case 'marca': {
      const [acao, arquivo] = args
      if (acao === 'aplicar') {
        if (!arquivo) throw new Error(AJUDA)
        const dados = JSON.parse(await readFile(arquivo, 'utf8'))
        const { logo, ...marca } = dados
        const r = await salvarMarca(pool, marca)
        if (r.erros) throw new Error(`Arquivo de marca inválido:\n${Object.entries(r.erros).map(([c, m]) => `  ${c}: ${m}`).join('\n')}`)
        console.log(`Marca aplicada: ${r.marca.nome}`)
        if (logo) await aplicarLogo(pool, resolve(dirname(arquivo), logo))
      } else if (acao === 'exportar') {
        const { logoUrl, versao, ...marca } = await carregarMarca(pool)
        const json = JSON.stringify(marca, null, 2) + '\n'
        if (arquivo) { await writeFile(arquivo, json); console.log(`Marca exportada para ${arquivo}`) }
        else process.stdout.write(json)
      } else if (acao === 'logo') {
        if (!arquivo) throw new Error(AJUDA)
        await aplicarLogo(pool, arquivo)
      } else {
        throw new Error(AJUDA)
      }
      break
    }
    case 'licenca': {
      const [acao, chave] = args
      if (acao === 'ativar') {
        if (!chave) throw new Error('Informe a chave: node server/cli.js licenca ativar XXX-0000')
        const r = await ativarLicenca(pool, { chave, origem: 'cli' })
        if (!r.ok) throw new Error(r.mensagem)
        console.log('✓ Sistema ativado.')
      } else if (acao === 'status') {
        const s = await situacaoLicenca(pool)
        console.log(s.ativada
          ? `Ativado em ${new Date(s.ativada_em).toLocaleString('pt-BR')} (${s.origem}${s.ativada_por ? `, por ${s.ativada_por}` : ''}).`
          : 'Ainda NÃO ativado.')
      } else {
        throw new Error(AJUDA)
      }
      break
    }
    default:
      console.log(AJUDA)
  }
} catch (e) {
  console.error(e.code === '23505' ? 'Já existe um usuário com este e-mail.' : e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
