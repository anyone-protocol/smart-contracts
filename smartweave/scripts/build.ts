import { NodePath } from '@babel/core'
import {
  getBabelOutputPlugin,
  RollupBabelInputPluginOptions
} from '@rollup/plugin-babel'
import typescript from '@rollup/plugin-typescript'
import { rollup } from 'rollup'
import cleanup from 'rollup-plugin-cleanup'
import prettier from 'rollup-plugin-prettier'

const contracts: { [key: string]: string } = {
  'relay-registry': 'src/contracts/relay-registry.ts',
  'distribution': 'src/contracts/distribution.ts'
}

const babelOpts: RollupBabelInputPluginOptions = {
  filename: 'relay-registry.ts',
  presets: [ '@babel/preset-typescript' ],
  plugins: [
    [{
      visitor: {
        ImportDeclaration(path: NodePath) {
          path.remove()
        },
        ExportDeclaration(path: NodePath) {
          path.remove()
        }
      }
    }]
  ]
}

async function build() {
  for (const contract in contracts) {
    const bundle = await rollup({
      input: contracts[contract],
      output: { format: 'cjs' },
      plugins: [
        typescript({
          'target': 'ES6',
          'module': 'ES6',
          'moduleResolution': 'node'
        }),
        getBabelOutputPlugin({ ...babelOpts, filename: contract }),
        cleanup(),
        prettier({ singleQuote: true, parser: 'babel' })
      ],
      external: [ /(..\/)+environment/, 'warp-contracts', 'bignumber.js' ],
      onwarn(warning, rollupWarn) {
        if (warning.code !== 'CIRCULAR_DEPENDENCY') {
          rollupWarn(warning)
        }
      }
    })

    bundle.write({ file: `dist/contracts/${contract}.js` })

    await bundle.close()
  }
}

(async () => {
  try {
    await build()
  } catch (error) {
    console.error('Build script error', error)
  }
})()
