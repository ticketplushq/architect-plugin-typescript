let { join } = require('path')
let { existsSync } = require('fs')
let { rm } = require('fs/promises')
let { build: esbuild } = require('esbuild')
let sourceMapStatement = `require('source-map-support/register');\n//# sourceMappingURL=index.js.map`

let projectCompiled = false

function getTsConfig (dir) {
  let path = join(dir, 'tsconfig.json')
  if (existsSync(path)) return path
  return false
}

async function buildSourceMapSupport (cwd, build) {
  return esbuild({
    entryPoints: [ join(cwd, 'node_modules', 'source-map-support', 'register') ],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outdir: join(build, 'node_modules', 'source-map-support'),
  })
}

async function compileProject ({ inventory }) {
  let { inv } = inventory
  let { cwd } = inv._project

  // Project already compiled
  if (projectCompiled == inv._project.build) return

  let start = Date.now()
  let globalTsConfig = getTsConfig(cwd)
  let ok = true
  console.log(`Compiling TypeScript`)

  const lambdas = Object.values(inventory.inv.lambdasBySrcDir)
  await compileHandler({ inventory, lambdas, globalTsConfig })
  if (ok) {
    console.log(`Compiled project in ${(Date.now() - start) / 1000}s`)
    projectCompiled = inv._project.build
  }
}

async function compileHandler (params) {
  let { inventory, lambdas, globalTsConfig } = params
  let { deployStage: stage } = inventory.inv._arc
  let { arc, cwd } = inventory.inv._project
  stage = stage || 'testing'

  // Enumerate project TS settings
  let configPath
  let settings = {
    sourcemaps: [ 'testing', 'staging' ],
    // TODO publicSrc?
  }
  if (arc.typescript) {
    arc.typescript.forEach(s => {
      if (Array.isArray(s)) {
        if (s[0] === 'sourcemaps') settings.sourcemaps = [ ...s.slice(1) ]
        if (s[0] === 'esbuild-config') configPath = join(cwd, s.slice(1)[0])
      }
    })
  }

  // Construct esbuild options
  // The following defaults cannot be changed
  let options = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
  }

  if (lambdas.length === 1) {
    let { build, src, handlerFile } = lambdas[0]

    await rm(build, { recursive: true, force: true })

    options.entryPoints = [ join(src, 'index.ts') ]
    options.outfile = handlerFile

    if (settings.sourcemaps.includes(stage) && stage !== 'testing') {
      await buildSourceMapSupport(cwd, build)
    }
  }
  else {
    let { build } = inventory.inv._project
    await rm(build, { recursive: true, force: true })

    options.entryPoints = lambdas.map(({ src }) => join(src, 'index.ts'))
    options.outdir = build

    // If all lambdas have the same pragma, use it as the outdir
    const pragmas = lambdas.map(({ pragma }) => pragma)
      .filter((value, index, self) => self.indexOf(value) === index)
    if (pragmas.length == 1) {
      options.outdir = join(build, pragmas[0])
    }

    if (settings.sourcemaps.includes(stage) && stage !== 'testing') {
      for (let lambda of lambdas) {
        await buildSourceMapSupport(cwd, lambda.build)
      }
    }
  }

  if (configPath) {
    // eslint-disable-next-line
    let config = require(configPath)
    options = { ...config, ...options }
  }

  if (settings.sourcemaps.includes(stage)) {
    options.sourcemap = 'external'
    if (options.banner?.js) {
      options.banner.js = options.banner.js + '\n' + sourceMapStatement
    }
    else options.banner = { js: sourceMapStatement }
  }

  // Final config check
  if (globalTsConfig) options.tsconfig = globalTsConfig

  // Run the build
  await esbuild(options)
}

module.exports = {
  compileHandler,
  compileProject,
  getTsConfig,
}
