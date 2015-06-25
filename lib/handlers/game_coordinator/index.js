var EventEmitter = require('events').EventEmitter;
var Steam = require('../../steam_client');

var EMsg = Steam.EMsg;
var schema = Steam.Internal;

var protoMask = 0x80000000;

module.exports = SteamGameCoordinator;

function SteamGameCoordinator(steamClient, appid) {
  this._client = steamClient;
  this._appid = appid;
  
  this._jobs = {};
  this._currentJobID = 0;
  
  this._client.on('message', function(header, body, callback) {
    if (header.msg in handlers)
      handlers[header.msg].call(this, body, callback);
  }.bind(this));
  
  this._client.on('logOnResponse', function() {
    this._jobs = {};
    this._currentJobID = 0;
  }.bind(this));
}

require('util').inherits(SteamGameCoordinator, EventEmitter);


// Methods

var prototype = SteamGameCoordinator.prototype;

prototype._send = function(header, body, callback) {
  if (callback) {
    var sourceJobID = ++this._currentJobID;
    this._jobs[sourceJobID] = callback;
  }
  
  if (header.proto) {
    header.proto.job_id_source = sourceJobID;
    header = new schema.MsgGCHdrProtoBuf(header);
  } else {
    header.sourceJobID = sourceJobID;
    header = new schema.MsgGCHdr(header);
  }
  
  this._client.send({
    msg: EMsg.ClientToGC,
    proto: {
      routing_appid: this._appid
    }
  }, new schema.CMsgGCClient({
    msgtype: header.proto ? header.msg | protoMask : header.msg,
    appid: this._appid,
    payload: Buffer.concat([header.toBuffer(), body])
  }));
};

prototype.send = function(header, body, callback) {
  // ignore any target job ID
  if (header.proto)
    delete header.proto.jobid_target;
  else
    delete header.targetJobID;
  this._send(header, body, callback);
};


// Handlers

var handlers = {};

handlers[EMsg.ClientFromGC] = function(data, jobid) {
  var msg = schema.CMsgGCClient.decode(data);
  
  if (msg.appid != this._appid)
    return;
  
  var header, sourceJobID, targetJobID;
  if (msg.msgtype & protoMask) {
    header = schema.MsgGCHdrProtoBuf.decode(msg.payload);
    sourceJobID = header.proto.job_id_source;
    targetJobID = header.proto.job_id_target;
  } else {
    header = schema.MsgGCHdr.decode(msg.payload);
    sourceJobID = header.sourceJobID;
    targetJobID = header.targetJobID;
  }
  
  if (sourceJobID != '18446744073709551615') {
    var callback = function(header, body, callback) {
      if (header.proto)
        header.proto.jobid_target = sourceJobID;
      else
        header.targetJobID = sourceJobID;
      this._send(header, body, callback);
    }.bind(this);
  }
  
  if (targetJobID in this._jobs)
    this._jobs[targetJobID](header, msg.payload.toBuffer(), callback);
  else
    this.emit('message', header, msg.payload.toBuffer(), callback);
};