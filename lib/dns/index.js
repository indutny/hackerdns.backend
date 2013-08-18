var util = require('util');
var dnsd = require('dnsd');
var async = require('async');

var common = require('../common');
var utils = common.utils;
var Domain = common.models.Domain;

function Server(conf) {
  common.Server.call(this, conf, 'dns');

  this.server = dnsd.createServer.defaults({
    ttl: 60
  })(this.handler.bind(this));
};
util.inherits(Server, common.Server);
exports.Server = Server;

exports.createServer = function createServer(conf) {
  return new Server(conf);
};

Server.prototype.handler = function handler(req, res) {
  var self = this;

  this.probe('request');

  function addSoa(domain, callback) {
    Domain.get(utils.tld(domain.toLowerCase()), function(err, domain) {
      if (err)
        return callback(null, false);
      callback(null, [{
        data: {
          'mname': self.conf.get('dns:mname'),
          'rname': self.conf.get('dns:rname'),
          'serial': (domain.mtime / 1e3) | 0,
          'refresh': self.conf.get('dns:refresh'),
          'retry'  : self.conf.get('dns:retry'),
          'expire' : self.conf.get('dns:expire'),
          'ttl'    : self.conf.get('dns:ttl')
        },
        ttl: self.conf.get('dns:ttl')
      }]);
    });
  }

  async.map(res.question, function(query, callback) {
    // Check if we've any records about the domain
    if (query.type.toUpperCase() === 'SOA') {
      addSoa(query.name, callback);
      return;
    }

    var key = query.type.toUpperCase() + '/' +
              query.name.toLowerCase();
    Domain.bySubdomain(key, function(err, items) {
      if (err)
        return callback(null, false);
      callback(null, items);
    });
  }, function(err, answers) {
    if (err || !Array.isArray(answers))
      return res.end();

    answers.forEach(function(items, i) {
      if (!items)
        return;
      var question = res.question[i];
      if (!question)
        return;

      items.forEach(function(item) {
        res.answer.push({
          name: question.name,
          type: question.type,
          data: item.data,
          ttl: item.ttl | 0
        });
      });
    });

    // XXX This is a bit hacky, but should work
    if (res.answer.length === 0 && req.question.length > 0) {
      // No answers - add soa
      addSoa(req.question[0].name, function(err, soa) {
        if (err)
          return res.end();
        soa.forEach(function(record) {
          res.answer.push({
            name: utils.tld(req.question[0].name),
            type: 'SOA',
            data: record.data,
            ttl: record.ttl | 0
          });
        });
        res.end();
      });
      return;
    }

    res.end();
  });
};

Server.prototype.start = function start(callback) {
  var waiting = 2;
  this.server.listen(this.conf.get('dns:port'),
                     this.conf.get('dns:hostname'));
  this.server.on('listening', callback);
};
