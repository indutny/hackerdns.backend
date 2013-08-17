var fs = require('fs');
var util = require('util');
var crypto = require('crypto');
var spdy = require('spdy');
var express = require('express');
var cors = require('cors');

var common = require('../common');

function Server(conf) {
  common.Server.call(this, conf, 'api');

  this.app = express();
  this.app.use(cors({ origin: 'http://hackerdns.com' }));
  this.app.use(express.bodyParser())
  this.app.use(this.tokenMiddleware.bind(this))
  this.app.use(this.app.router);

  this.server = spdy.createServer({
    cert: fs.readFileSync(conf.get('api:ssl:cert')),
    key: fs.readFileSync(conf.get('api:ssl:key'))
  }, this.app);

  this.server.on('request', this.probe.bind(this, 'request'));

  this.initRoutes();
};
util.inherits(Server, common.Server);
exports.Server = Server;

exports.createServer = function createServer(conf) {
 return new Server(conf);
};

Server.prototype.initRoutes = function initRoutes() {
  // Simplified signup+login
  this.app.post('/signup', this.handleSignup.bind(this));

  // Record management
  this.app.get('/dns/:domain', this.handleGetRecords.bind(this));
  this.app.post('/dns', this.handleAddRecords.bind(this));
  this.app.del('/dns', this.handleRemoveRecords.bind(this));
};

Server.prototype.tokenMiddleware = function tokenMiddleware(req, res, next) {
  req.user = null;
  if (!req.body.token) {
    if (req.url === '/signup' && req.method === 'POST' ||
        req.method === 'GET' && /^\/dns\/[^\/]+$/.test(req.url)) {
      return next();
    }

    return res.json(403, { error: 'Missing token' });
  }

  this.db.get(this.dbKey('token', req.body.token), function(err, user) {
    if (err)
      return res.json(403, { error: 'Incorrect token' });

    req.user = user;
    next();
  });
};

Server.prototype.handleSignup = function handleSignup(req, res) {
  if (!req.body.user || !req.body.password)
    return res.json(400, { error: '`user` and `password` are required' });

  var self = this;
  var dbKey = this.dbKey('user', req.body.user);
  var salt = crypto.randomBytes(this.conf.get('api:pbkdf2:saltlen'));
  var iterations = this.conf.get('api:pbkdf2:iterations');
  var len = this.conf.get('api:pbkdf2:length');
  crypto.pbkdf2(req.body.password, salt, iterations, len, function(err, key) {
    if (err)
      return res.json(500, { error: 'pbkdf2 failed' });

    self.db.setnx(dbKey, JSON.stringify({
      pbkdf2: key.toString('base64'),
      salt: salt.toString('base64'),
      iterations: iterations
    }), function(err, r) {
      if (err)
        return res.json(500, { error: 'redis setnx failed (handleSignup)' });

      // User already exists
      if (!r)
        return self.handleLogin(req, res);

      self.giveToken(req, res);
    });
  });
};

Server.prototype.handleLogin = function handleLogin(req, res) {
  if (!req.body.user || !req.body.password)
    return res.json(400, { error: '`user` and `password` are required' });

  var self = this;
  var dbKey = this.dbKey('user', req.body.user);
  this.db.get(dbKey, function(err, value) {
    if (err)
      return res.json(500, { error: 'redis get failed' });
    if (!value)
      return res.json(400, { error: 'invalid username' });

    try {
      var user = JSON.parse(value);
    } catch (e) {
      if (e)
        return res.json(500, { error: 'invalid user object' });
    }

    var salt = new Buffer(user.salt, 'base64');
    var pbkdf2 = new Buffer(user.pbkdf2, 'base64');
    crypto.pbkdf2(req.body.password,
                  salt,
                  user.iterations,
                  pbkdf2.length,
                  function(err, derivedKey) {
      if (err)
        return res.json(500, { error: 'pbkdf2 failed' });

      if (derivedKey.toString('base64') !== user.pbkdf2)
        return res.json(403, { error: 'invalid password' });

      self.giveToken(req, res);
    });
  });
};

Server.prototype.handleGetRecords = function handleGetRecords(req, res) {
  // TODO: support AAAA
  var types = ['A', 'MX', 'NS', 'CNAME', 'TXT'];

  var multi = this.db.multi();
  types.forEach(function(type) {
    var key = this.dbKey('domain',
                         req.params.domain.toLowerCase(),
                         type.toLowerCase());
    multi.smembers(key);
  }, this);

  multi.exec(function(err, results) {
    if (err)
      return res.json(500, { error: 'redis multi() failed' });

    res.json(200, results.reduce(function(acc, items, i) {
      // Add record type to each result
      return acc.concat(items.map(function(item) {
        try {
          var value = JSON.parse(item);
        } catch (e) {
          // Ignore malformed data
          return;
        }
        return {
          type: types[i],
          data: value.data,
          ttl: value.ttl
        };
      }));
    }, []));
  });
};

Server.prototype.validateRecords = function validateRecords(user,
                                                            records,
                                                            res,
                                                            callback) {
  if (!user)
    return res.json(403, { error: 'token is required' });

  if (!Array.isArray(records))
    return res.json(400, { error: '`records` is a required field' });

  var types = ['A', 'MX', 'NS', 'CNAME', 'TXT'];
  var domains = [];

  // Top-Level domain parser
  function tld(domain) {
    var match = domain.match(/([a-z0-9\-]+\.[a-z]{2,6})\.?$/);
    if (!match)
      return false;

    return match[1];
  }

  var validate = records.every(function(record) {
    var domain = tld((record.domain + '').toLowerCase());
    if (!domain)
      return false;

    if (domains.indexOf(domain) === -1)
      domains.push(domain);

    var type = record.type.toUpperCase();
    function validateData(data) {
      if (type === 'A' || type === 'NS' || type === 'CNAME')
        return typeof data === 'string';
      if (type === 'MX')
        return Array.isArray(data) && data.length === 2 &&
               typeof data[0] === 'number' && typeof data[1] === 'string';
      if (type === 'TXT')
        return Array.isArray(data);
      return false;
    }

    return types.indexOf(type) !== -1 &&
           typeof record.ttl === 'number' &&
           validateData(record.data);
  });
  if (!validate)
    return res.json(400, { error: 'invalid record' });

  // Check that all domains are claimed
  var multi = this.db.multi();
  domains.forEach(function(domain) {
    var key = this.dbKey('domain', domain);
    multi.get(key);
  }, this);

  var self = this;
  multi.exec(function(err, results) {
    if (err)
      return res.json(500, { error: 'redis multi failed (addRecords)' });

    // Claim domains that wasn't yet claimed
    var claim = self.db.multi();
    var others = [];
    var owner = results.every(function(result, i) {
      if (!result) {
        claim.setnx(self.dbKey('domain', domains[i]), user);
      } else if (result !== user) {
        others.push(domains[i]);
        return false;
      }

      return true;
    });

    if (!owner) {
      return res.json(500, {
        error: 'Some domains are claimed by other users',
        domains: others
      });
    }

    claim.exec(function(err, results) {
      if (err)
        return res.json(500, { error: 'domain claim failed' });

      var success = results.every(function(result) {
        return result;
      });

      // Try again, some domains were claimed by another user (or by us?!)
      if (!success)
        return self.validateRecords(user, records, res, callback);

      // Yikes!
      callback.call(self);
    });
  });
};

Server.prototype.handleAddRecords = function handleAddRecords(req, res) {
  var self = this;
  this.validateRecords(req.user, req.body.records, res, function() {
    var add = this.db.multi();

    req.body.records.forEach(function(record) {
      var key = self.dbKey('domain',
                           record.domain.toLowerCase(),
                           record.type.toLowerCase());
      var value = { ttl: record.ttl, data: record.data };
      add.sadd(key, JSON.stringify(value));
    });

    add.exec(function(err) {
      if (err)
        return res.json(500, { error: 'Failed to add records' });

      res.json(200, { ok: true });
    });
  });
};

Server.prototype.handleRemoveRecords = function handleRemoveRecords(req, res) {
  var self = this;
  this.validateRecords(req.user, req.body.records, res, function() {
    var rm = this.db.multi();

    req.body.records.forEach(function(record) {
      var key = self.dbKey('domain',
                           record.domain.toLowerCase(),
                           record.type.toLowerCase());
      var value = { ttl: record.ttl, data: record.data };
      rm.srem(key, JSON.stringify(value));
    });

    rm.exec(function(err) {
      if (err)
        return res.json(500, { error: 'Failed to remove records' });

      res.json(200, { ok: true });
    });
  });
};

Server.prototype.giveToken = function giveToken(req, res) {
  if (!req.body.user)
    return res.json(500, { error: 'Invalid giveToken invokation' });

  var self = this;
  var token = crypto.randomBytes(this.conf.get('api:token:length'))
                    .toString('base64');
  var dbKey = this.dbKey('token', token);
  this.db.setnx(dbKey, req.body.user, function(err, r) {
    if (err)
      return res.json(500, { error: 'redis setnx failed (giveToken)' });

    // Try again
    if (!r)
      return self.giveToken(req, res);

    self.db.expire(dbKey, self.conf.get('api:token:ttl'));
    res.json(200, { ok: true, token: token });
  });
};

Server.prototype.start = function start(callback) {
  this.server.listen(this.conf.get('api:port'),
                     this.conf.get('api:hostname'),
                     callback);
};
