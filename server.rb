# Local dev server: `ruby server.rb [port]` (default 5173).
# Same as `ruby -run -e httpd .` but tells the browser to re-check every file on
# each load (a quick 304 when nothing changed), so edits never hide behind
# Chrome's cache.
require 'webrick'

port = (ARGV[0] || 5173).to_i
server = WEBrick::HTTPServer.new(
  Port: port,
  BindAddress: '127.0.0.1', # localhost only: don't serve this folder (and .git) to the network
  DocumentRoot: __dir__,
  AccessLog: [],
  RequestCallback: ->(_req, res) { res['Cache-Control'] = 'no-cache' }
)
trap('INT') { server.shutdown }
trap('TERM') { server.shutdown }
puts "Scoreboard on http://localhost:#{port}"
server.start
