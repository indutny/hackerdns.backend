var fs = require('fs');
var util = require('util');
var crypto = require('crypto');
var spdy = require('spdy');
var express = require('express');
var cors = require('cors');
var async = require('async');

var utils = require('./utils');
var common = require('../common');
var User = common.models.User;
var Domain = common.models.Domain;

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
  this.app.post('/logout', this.handleLogout.bind(this));

  // Record management
  this.app.get('/dns', this.handleGetRecords.bind(this));
  this.app.get('/dns/:domain', this.handleGetDomainRecords.bind(this));
  this.app.post('/dns', this.handleAddRecords.bind(this));
  this.app.del('/dns', this.handleRemoveRecords.bind(this));
};

Server.prototype.tokenMiddleware = function tokenMiddleware(req, res, next) {
  req.user = null;
  req.token = null;

  var token = req.body.token || req.headers['x-hackerdns-token'];
  if (!token) {
    if (req.url === '/signup' && req.method === 'POST')
      return next();

    return res.json(403, { error: 'Missing token' });
  }

  this.redis.get(this.redisKey('token', token), function(err, user) {
    if (err || !user)
      return res.json(403, { error: 'Incorrect token' });

    User.get(user, function(err, user) {
      if (err)
        return res.json(403, { error: 'User does not exist' });

      req.user = user;
      req.token = token;
      next();
    });
  });
};

// Routes

Server.prototype.handleSignup = function handleSignup(req, res) {
  if (!req.body.email || !req.body.password)
    return res.json(400, { error: '`email` and `password` are required' });

  var self = this;
  var salt = crypto.randomBytes(this.conf.get('api:pbkdf2:saltlen'));
  var iterations = this.conf.get('api:pbkdf2:iterations');
  var len = this.conf.get('api:pbkdf2:length');
  crypto.pbkdf2(req.body.password, salt, iterations, len, function(err, key) {
    if (err)
      return res.json(500, { error: 'pbkdf2 failed' });

    User.create({
      email: req.body.email,
      pbkdf2: key.toString('base64'),
      salt: salt.toString('base64'),
      iterations: iterations
    }, function(err, user) {
      // User already exists
      // TODO: Handle other errors
      if (err)
        return self.handleLogin(req, res);

      self.giveToken(req, res);
    });
  });
};

Server.prototype.handleLogin = function handleLogin(req, res) {
  if (!req.body.email || !req.body.password)
    return res.json(400, { error: '`email` and `password` are required' });

  var self = this;
  User.get(req.body.email, function(err, user) {
    if (err) {
      return res.json(500, {
        error: 'Failed to fetch user',
        reason: err.message
      });
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

Server.prototype.handleLogout = function handleLogout(req, res) {
  var redisKey = this.redisKey('token', req.token);
  this.redis.del(redisKey, function() {
    res.json(200, { ok: true });
  });
};

Server.prototype.handleGetRecords = function handleGetRecords(req, res) {
  req.user.getDomains(function(err, domains) {
    if (err)
      return res.json(500, { error: 'Get user domains failed' });

    var out = domains.map(function(domain) {
      return {
        domain: domain.domain,
        records: domain.records
      };
    });

    res.json(200, out);
  });
};

Server.prototype.handleGetDomainRecords =
    function handleGetDomainRecords(req, res) {

  Domain.get(req.params.domain.toLowerCase(), function(err, domain) {
    if (err)
      return res.json(500, { error: 'Get subdomains failed' });
    if (domain.owner !== req.user.key)
      return res.json(403, { error: 'You are not owner of this domain' });

    res.json(200, {
      domain: domain.domain,
      records: domain.records
    });
  });
};

Server.prototype.handleAddRecords = function handleAddRecords(req, res) {
  if (!req.body.domain || !Array.isArray(req.body.records)) {
    return res.json(400, {
      error: '`domain` and `recods` are required fields'
    });
  }
  this.validateRecords(req.user,
                       req.body.domain,
                       req.body.records,
                       res,
                       function() {
    Domain.get(req.body.domain.toLowerCase(), function(err, domain) {
      if (err)
        return callback(err);

      domain.records = req.body.records.concat(domain.records);
      domain.save(function(err) {
        if (err) {
          return res.json(500, {
            error: 'Failed to add records',
            reason: err.message
          });
        }

        res.json(200, { ok: true });
      });
    });
  });
};

Server.prototype.handleRemoveRecords = function handleRemoveRecords(req, res) {
  if (!req.body.domain || !Array.isArray(req.body.records)) {
    return res.json(400, {
      error: '`domain` and `recods` are required fields'
    });
  }

  this.validateRecords(req.user,
                       req.body.domain,
                       req.body.records,
                       res,
                       function() {
    Domain.get(req.body.domain.toLowerCase(), function(err, domain) {
      if (err)
        return callback(err);

      domain.records = domain.records.filter(function(entry) {
        return req.body.records.every(function(record) {
          if (entry.sub !== record.sub)
            return true;

          if (entry.ttl !== record.ttl)
            return true;

          if (typeof record.data === 'string') {
            if (record.data !== entry.data)
              return true;
          } else if (Array.isArray(record.data)) {
            if (record.data.length !== entry.data.length)
              return true;
            for (var i = 0; i < record.data.length; i++)
              if (record.data[i] !== entry.data[i])
                return true;
          }

          return false;
        });
      });

      domain.save(function(err) {
        if (err) {
          return res.json(500, {
            error: 'Failed to remove records',
            reason: err.message
          });
        }
        res.json(200, { ok: true });
      });
    });
  });
};

// Utils

Server.prototype.giveToken = function giveToken(req, res) {
  if (!req.body.email)
    return res.json(500, { error: 'Invalid giveToken invokation' });

  var self = this;
  var token = crypto.randomBytes(this.conf.get('api:token:length'))
                    .toString('base64');
  var redisKey = this.redisKey('token', token);
  this.redis.setnx(redisKey, req.body.email, function(err, r) {
    if (err)
      return res.json(500, { error: 'redis setnx failed (giveToken)' });

    // Try again
    if (!r)
      return self.giveToken(req, res);

    self.redis.expire(redisKey, self.conf.get('api:token:ttl'));
    res.json(200, { ok: true, token: token });
  });
};

Server.prototype.validateRecords = function validateRecords(user,
                                                            domain,
                                                            records,
                                                            res,
                                                            callback) {
  if (!user)
    return res.json(403, { error: 'token is required' });

  if (!Array.isArray(records))
    return res.json(400, { error: '`records` is a required field' });

  var types = ['A', 'MX', 'NS', 'CNAME', 'TXT'];

  var validate = records.every(function(record) {
    if (typeof record.sub !== 'string')
      return false;

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

  // Check that domain is claimed
  var self = this;
  Domain.get(domain, function(err, d) {
    var owner = !err && d.owner;

    if (!owner) {
      // Claim domain that wasn't yet claimed
      user.createDomain({ domain: domain }, function(err) {
        if (err) {
          return res.json(500, {
            error: 'Domain claim failed',
            reason: err.message
          });
        }

        // Yikes
        callback(null);
      });
      return;
    } else if (owner !== user.key) {
      return res.json(403, { error: 'Domain is claimed by other user' });
    }

    // Yikes!
    callback(null);
  });
};

Server.prototype.start = function start(callback) {
  this.server.listen(this.conf.get('api:port'),
                     this.conf.get('api:hostname'),
                     callback);
};
