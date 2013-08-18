var util = require('util');
var dnsd = require('dnsd');
var async = require('async');

var common = require('../common');
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

  async.map(res.question, function(query, callback) {
    Domain.bySubdomain(query.type.toUpperCase() + '/' +
                           query.name.toLowerCase(),
                       callback);
  }, function(err, answers) {
    if (err || !Array.isArray(answers))
      return res.end();

    answers.forEach(function(items, i) {
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

    res.end();
  });
};

Server.prototype.start = function start(callback) {
  var waiting = 2;
  this.server.listen(this.conf.get('dns:port'),
                     this.conf.get('dns:hostname'));
  this.server.on('listening', callback);
};
