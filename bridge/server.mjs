import { Atem } from 'atem-connection'
import { isIP } from 'node:net'
import { createBridge } from './core.mjs'

const address = process.env.ATEM_ADDRESS || ''
const port = Number(process.env.ATEM_BRIDGE_PORT || 8788)
if (isIP(address) !== 4 || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)) {
  throw new Error('ATEM_ADDRESS must be the private LAN IPv4 address of your ATEM')
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid bridge port')
const atem = new Atem()
const server = createBridge({
  atem,
  token: process.env.ATEM_BRIDGE_TOKEN,
  origins: (process.env.ATEM_BRIDGE_ORIGINS || 'https://aominn.github.io').split(',').map((value) => value.trim())
})
server.listen(port, '127.0.0.1', () => {
  console.log(`ATEM bridge listening on loopback port ${port}. Token is not logged.`)
  void atem.connect(address).catch(() => console.error('ATEM connection failed. Check LAN and ATEM address.'))
})
const shutdown = () => {
  server.close()
  server.closeAllConnections()
  void atem.destroy()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
