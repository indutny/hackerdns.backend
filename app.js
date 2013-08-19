var cluster = require('cluster');
var resourceful = require('resourceful');

var nconf = require('nconf')
    .argv()
    .env()
    .file({ file: 'config.json' })
    .defaults({
      server: 'dns1',
      probe: {
        names: 'request',
        interval: 60000
      },
      db: {
        host: '127.0.0.1',
        port: 5984,
        database: 'hackerdns',
        auth: {
          username: 'admin',
          password: 'admin'
        }
      },
      redis: {
        host: '127.0.0.1',
        port: 6379,
        prefixes: {
          token: 't',
          probe: 'p'
        }
      },
      api: {
        ssl: {
          cert: __dirname + '/keys/cert.pem',
          key: __dirname + '/keys/key.pem'
        },
        pbkdf2: {
          saltlen: 16,
          iterations: 100,
          length: 20
        },
        token: {
          length: 20,
          ttl: 3600
        },
        port: 44300,
        hostname: '127.0.0.1',
        workers: 1
      },
      dns: {
        port: 5959,
        hostname: '127.0.0.1',
        mname: 'ns1.hackerdns.com',
        rname: 'indutny.com',
        refresh: 3600,
        retry: 900,
        expire: 1209600,
        ttl: 3600,
        ns: [
          { host: 'ns1.hackerdns.com', ip: '1.1.1.1' },
          { host: 'ns2.hackerdns.com', ip: '1.1.1.1' },
          { host: 'ns3.hackerdns.com', ip: '1.1.1.1' },
          { host: 'ns4.hackerdns.com', ip: '1.1.1.1' },
          { host: 'ns5.hackerdns.com', ip: '1.1.1.1' },
          { host: 'ns6.hackerdns.com', ip: '1.1.1.1' }
        ]
      }
    });

// Initialize resourceful and models
resourceful.use('couchdb', nconf.get('db'));
var common = require('./lib/common');

// Start apps
var api = require('./lib/api');
var dns = require('./lib/dns');

var app = process.argv[process.argv.length - 1];
if (app !== 'dns' && app !== 'api')
  app = null;

if (cluster.isMaster && (!app || app === 'dns')) {
  dns.createServer(nconf).start(function() {
    console.log('DNS Server is up and running at %s:%d',
                nconf.get('dns:hostname'),
                nconf.get('dns:port'));
  });
}

if (!app|| app === 'api') {
  if (cluster.isMaster && nconf.get('api:workers') != 1) {
    function fork() {
      cluster.fork().once('exit', fork);
    }

    for (var i = 0; i < nconf.get('api:workers'); i++) {
      cluster.fork();
    }
    return;
  }
  api.createServer(nconf).start(function() {
    console.log('API Server is up and running at %s:%d',
                nconf.get('api:hostname'),
                nconf.get('api:port'));
  });
}
