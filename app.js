var nconf = require('nconf');
var cluster = require('cluster');

nconf.argv()
     .env()
     .file({ file: 'config.json' });

nconf.set('server', 'dns1');
nconf.set('probe:names', 'request');
nconf.set('probe:interval', '60000');
nconf.set('db:hostname', '127.0.0.1');
nconf.set('db:port', 6379);
nconf.set('db:prefix:probe', 'p');
nconf.set('db:prefix:domain', 'd');
nconf.set('db:prefix:session', 's');
nconf.set('db:prefix:token', 't');
nconf.set('db:prefix:user', 'u');
nconf.set('api:ssl:cert', __dirname + '/keys/cert.pem');
nconf.set('api:ssl:key', __dirname + '/keys/key.pem');
nconf.set('api:pbkdf2:saltlen', 16);
nconf.set('api:pbkdf2:iterations', 100);
nconf.set('api:pbkdf2:length', 20);
nconf.set('api:token:length', 20);
nconf.set('api:token:ttl', 3600);
nconf.set('api:port', 44300);
nconf.set('api:hostname', '0.0.0.0');
nconf.set('api:workers', 1);
nconf.set('dns:port', 5959);
nconf.set('dns:hostname', '127.0.0.1');

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
