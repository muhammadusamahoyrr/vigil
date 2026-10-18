// Production start (npm start): apply migrations, seed demo data when DEMO_MODE=true,
// then run the web server AND the worker loops in one service. A separate worker
// service also works (set RUN_WORKER_IN_WEB=false here); running both is safe because
// the lead engine serializes on advisory locks and the outbox uses SKIP LOCKED.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// npm needs a shell on Windows (npm.cmd); node itself must not go through one (paths with spaces)
const npm = args => spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { stdio: 'inherit', shell: process.platform === 'win32' })
const node = args => spawn(process.execPath, args, { stdio: 'inherit' })

const step = args => new Promise((resolve, reject) =>
  npm(args).on('exit', code => (code === 0 ? resolve() : reject(new Error(`npm ${args.join(' ')} failed (${code})`)))))

await step(['run', 'migrate'])
await step(['run', 'seed:demo'])

let stopping = false
let worker = null
function startWorker() {
  worker = npm(['run', 'worker'])
  worker.on('exit', code => {
    if (stopping) return
    console.error(`[start] worker exited (${code}); restarting in 2s`)
    setTimeout(startWorker, 2000)
  })
}
if (process.env.RUN_WORKER_IN_WEB !== 'false') startWorker()

const web = node([require.resolve('next/dist/bin/next'), 'start'])
web.on('exit', code => { stopping = true; worker?.kill(); process.exit(code ?? 1) })

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { stopping = true; worker?.kill(sig); web.kill(sig) })
}
