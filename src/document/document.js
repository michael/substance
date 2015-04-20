'use strict';

var Substance = require('../basics');
var Data = require('../data');

var AnnotationIndex = require('./annotation_index');
var ContainerAnnotationIndex = require('./container_annotation_index');

var TransactionDocument = require('./transaction_document');
var DocumentChange = require('./document_change');

var NotifyPropertyChange = require('./notify_property_change');

function Document( schema, seed ) {
  Substance.EventEmitter.call(this);

  this.schema = schema;
  this.seed = seed;

  this.data = new Data.IncrementalGraph(schema, {
    seed: seed,
    didCreateNode: Substance.bind(this._didCreateNode, this),
    didDeleteNode: Substance.bind(this._didDeleteNode, this),
  });

  // all by type
  this.nodeIndex = this.addIndex('type', Substance.Data.Index.create({
    property: "type"
  }));
  // special index for (property-scoped) annotations
  this.annotationIndex = this.addIndex('annotations', new AnnotationIndex());

  // registry for containers
  this.containers = {};
  // special index for (contaoiner-scoped) annotations
  this.containerAnnotationIndex = this.addIndex('container-annotations', new ContainerAnnotationIndex());

  // the stage is a essentially a clone of this document
  // used to apply a sequence of document operations
  // without touching this document
  this.stage = new TransactionDocument(this);
  this.isTransacting = false;

  this.done = [];
  this.undone = [];

  // change event proxies are triggered after a document change has been applied
  // before the regular document:changed event is fired.
  // They serve the purpose of making the event notification more efficient
  // In earlier days all observers such as node views where listening on the same event 'operation:applied'.
  // This did not scale with increasing number of nodes, as on every operation all listeners where notified.
  // The proxies filter the document change by interest and then only notify a small set of observers.
  // Example: NotifyByPath notifies only observers which are interested in changes to a certain path.
  this.eventProxies = {
    'path': new NotifyPropertyChange(this),
  };
}

Document.Prototype = function() {

  this.newInstance = function() {
    return new Document(this.schema);
  };

  this.fromSnapshot = function(data) {
    return new Document(this.schema, data);
  };

  this.getSchema = function() {
    return this.schema;
  };

  this.get = function(path) {
    return this.data.get(path);
  };

  this.getNodes = function() {
    return this.data.getNodes();
  };

  this.addContainer = function(id, container) {
    if (this.containers[id]) {
      throw new Error('Container with id ' + id + ' already exists.');
    }
    this.containers[id] = container;
  };

  this.getContainer = function(id) {
    return this.containers[id];
  };

  this.removeContainer = function(id) {
    delete this.containers[id];
  };

  this.addIndex = function(name, index) {
    return this.data.addIndex(name, index);
  };

  this.getIndex = function(name) {
    return this.data.getIndex(name);
  };

  this.getEventProxy = function(name) {
    return this.eventProxies[name];
  };

  this.toJSON = function() {
    return {
      schema: [this.schema.name, this.schema.version],
      nodes: this.getNodes()
    };
  };

  // Document manipulation
  //
  // var tx = doc.startTransaction()
  // tx.create(...);
  // ...
  // tx.save();
  //
  // Note: there is no direct manipulation without transaction
  this.startTransaction = function(beforeState) {
    if (this.isTransacting) {
      throw new Error('Nested transactions are not supported.');
    }
    this.isTransacting = true;
    // TODO: maybe we need to prepare the stage
    this.stage.before = beforeState || {};
    this.emit('transaction:started', this.stage);
    return this.stage;
  };

  this.create = function(nodeData) {
    if (this.isTransacting) {
      this.stage.create(nodeData);
    } else {
      this.stage.create(nodeData);
      this.data.create(nodeData);
    }
    return this.data.get(nodeData.id);
  };

  this.delete = function(nodeId) {
    if (this.isTransacting) {
      this.stage.delete(nodeId);
    } else {
      this.stage.delete(nodeId);
      this.data.delete(nodeId);
    }
  };

  this.set = function(path, value) {
    if (this.isTransacting) {
      this.stage.set(path, value);
    } else {
      this.stage.set(path, value);
      this.data.set(path, value);
    }
  };

  this.update = function(path, diff) {
    if (this.isTransacting) {
      this.stage.update(path, diff);
    } else {
      this.stage.update(path, diff);
      this.data.update(path, diff);
    }
  };

  this._saveTransaction = function(beforeState, afterState, info) {
    if (!this.isTransacting) {
      throw new Error('Not in a transaction.');
    }
    this.isTransacting = false;
    var ops = this.stage.getOperations();
    var documentChange = new DocumentChange(ops, beforeState, afterState);
    // apply the change
    this._apply(documentChange, 'skipStage');
    // push to undo queue and wipe the redo queue
    this.done.push(documentChange);
    this.undone = [];
    this._notifyChangeListeners(documentChange, info);
  };

  this._cancelTransaction = function() {
    if (!this.isTransacting) {
      throw new Error('Not in a transaction.');
    }
    this.isTransacting = false;
  };

  this.undo = function() {
    var change = this.done.pop();
    if (change) {
      var inverted = change.invert();
      this._apply(inverted);
      this.undone.push(inverted);
      this._notifyChangeListeners(inverted, { 'replay': true });
    } else {
      console.error('No change can be undone.');
    }
  };

  this.redo = function(){
    var change = this.undone.pop();
    if (change) {
      var inverted = change.invert();
      this._apply(inverted);
      this.done.push(inverted);
      this._notifyChangeListeners(inverted, { 'replay': true });
    } else {
      console.error('No change can be redone.');
    }
  };

  // sel: PropertySelection
  // options: container
  this.getAnnotationsForSelection = function(sel, options) {
    options = options || {};
    var annotations;
    var path, startOffset, endOffset;
    if (sel.isContainerSelection()) {
      if (options.container) {
        return this.getContainerAnnotationsForSelection(sel, options.container, options);
      } else {
        console.error('You did not sepcify a container');
        return [];
      }
    }
    if (sel.isPropertySelection()) {
      path = sel.getPath();
      startOffset = sel.getStartOffset();
      endOffset = sel.getEndOffset();
    }
    annotations = this.annotationIndex.get(path, startOffset, endOffset);
    if (options.type) {
      annotations = Substance.filter(annotations, AnnotationIndex.filterByType(options.type));
    }
    return annotations;
  };

  // Attention: looking for container annotations is not as efficient
  // as property selections, as we do not have an index that has
  // notion of the spatial extend of an annotation
  // (which would depend on a model-side implementation of Container).
  // Opposed to that, common annotations are bound to properties which make it easy to lookup.
  this.getContainerAnnotationsForSelection = function(sel, container, options) {
    if (!container) {
      throw new Error('Container required.');
    }
    var annotations;
    // Also look for container annotations if a Container instance is given
    if (options.type) {
      annotations = this.getIndex('type').get(options.type);
    } else {
      annotations = this.getIndex('container-annotations').byId;
    }
    annotations = Substance.map(annotations, function(anno) {
      var annoSel = anno.getSelection();
      if (sel.overlaps(annoSel)) {
        return anno;
      }
    });
    return annotations;
  };

  // Called back by Substance.Data after a node instance has been created
  this._didCreateNode = function(node) {
    // create the node from schema
    node.attach(this);
  };

  this._didDeleteNode = function(node) {
    // create the node from schema
    node.detach(this);
  };

  this._apply = function(documentChange, mode) {
    if (this.isTransacting) {
      throw new Error('Can not replay a document change during transaction.');
    }
    // Note: we apply everything doubled, to keep the staging clone up2date.
    if (mode !== 'skipStage') {
      this.stage.apply(documentChange);
    }
    Substance.each(documentChange.ops, function(op) {
      this.data.apply(op);
    }, this);
  };

  this._notifyChangeListeners = function(documentChange, info) {
    info = info || {};
    Substance.each(this.eventProxies, function(proxy) {
      proxy.onDocumentChanged(documentChange, info);
    });
    this.emit('document:changed', documentChange, info);
  };

};

Substance.inherit(Document, Substance.EventEmitter);

Object.defineProperty(Document.prototype, 'id', {
  get: function() {
    return this.get('document').guid;
  },
  set: function() {
    throw new Error("Id is an immutable property.");
  }
});

module.exports = Document;
