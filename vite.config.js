import { createReadStream } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootRequire = createRequire(import.meta.url)
const reactPdfRequire = createRequire(rootRequire.resolve('react-pdf/package.json'))
const pdfWorkerPath = reactPdfRequire.resolve(
  'pdfjs-dist/build/pdf.worker.min.mjs',
)
const pdfWorkerPublicPath = '/pdf.worker.min.mjs'

function localPdfWorker() {
  return {
    name: 'local-pdf-worker',
    configureServer(server) {
      server.middlewares.use(pdfWorkerPublicPath, (request, response, next) => {
        if (!['GET', 'HEAD'].includes(request.method)) {
          next()
          return
        }

        response.setHeader('Cache-Control', 'no-cache')
        response.setHeader('Content-Type', 'text/javascript')

        if (request.method === 'HEAD') {
          response.end()
          return
        }

        const stream = createReadStream(pdfWorkerPath)
        stream.on('error', next)
        stream.pipe(response)
      })
    },
    async writeBundle(outputOptions) {
      const outputDirectory = outputOptions.dir || resolve('dist')
      await copyFile(
        pdfWorkerPath,
        resolve(outputDirectory, pdfWorkerPublicPath.slice(1)),
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localPdfWorker()],
  server: {
    proxy: {
      '/socket.io': {
        target: 'http://127.0.0.1:4000',
        ws: true,
      },
    },
  },
})
