# Substance

Building a web editor is a hard task. Native browser support for text editing is [limited and not reliable](https://medium.com/medium-eng/why-contenteditable-is-terrible-122d8a40e480) and there are many pitfalls such as handling selections, copy&paste or undo/redo. Substance was developed to solve the common problems of web-editing and provides API's for building custom editors.

With Substance you can:

- Define a *custom article schema*
- Manipulate content and annotations using *operations* and *transactions*
- Define custom HTML structure and attach a `Substance Surface` on it to make it editable
- Implement custom tools for any possible task like toggling annotations, inserting content or replacing text
- Control *undo/redo* behavior and *copy&paste*
- and more.

## Getting started

Let's develop a basic Rich Text Editor using Substance. We will define a simple article format, and an editor to manipulate it in the browser. Follow our guide here to get a feeling about the available concepts. Get your hands dirty by playing around with our [starter package](https://github.com/substance/starter) and if you feel more ambitious you can look at our [Science Writer](https://github.com/substance/science-writer) app.

### Define a custom article format

Modelling a schema is easy.

```js
var schema = new Substance.Document.Schema("rich-text-article", "1.0.0");
```

Substance has a number of predefined commonly used Node types, that we are going to borrow for our schema. But defining our own is very simple too.

```js
var Paragraph = Substance.Document.Paragraph;
var Emphasis = Substance.Document.Emphasis;
var Strong = Substance.Document.Strong;

var Highlight = Document.Annotation.extend({
  name: "highlight"
});

schema.addNodes([
  Paragraph,
  Emphasis,
  Strong,
  Highlight
]);
```

We need to specify a default text type, which will be the node being created when you hit enter.

```js
schema.getDefaultTextType = function() {
  return "paragraph";
};
```

Based on Substance Document, we now define a Javascript class, that will hold our future documents.

```js
var RichTextArticle = function() {
  RichTextArticle.super.call(this, schema);
};

RichTextArticle.Prototype = function() {
  this.initialize = function() {
    this.super.initialize.apply(this, arguments);

    // We will create a default container node `body` that references arbitrary many
    // content nodes, most likely paragraphs.
    this.create({
      type: "container",
      id: "body",
      nodes: []
    });
  };
};

Substance.inherit(RichTextArticle, Document);

RichTextArticle.schema = schema;
```

### Create an article programmatically

Create a new document instance.

```js
var doc = new RichTextArticle();
```

Create several paragraph nodes

```js
doc.create({
  id: "p1",
  type: "paragraph",
  content: "Hi I am a Substance paragraph."
});

doc.create({
  id: "p2",
  type: "paragraph",
  content: "And I am the second pargraph"
});
```

A Substance document works like an object store, you can create as many nodes as you wish and assign unique id's to them. However in order to show up as content, we need to show them on a container.

```js
// Get the body container
var body = doc.get('body');

body.show('p1');
body.show('p2');
```

Now let's make a **strong** annotation. With Substance you store annotations separate from the text. Annotations are just regular nodes in the document. They refer to a certain range (startOffset, endOffset) in a text property (path).

```js
doc.create({
  "id": "s1",
  "type": "strong",
  "path": [
    "p1",
    "content"
  ],
  "startOffset": 10,
  "endOffset": 19
});
```

So that's enough for the start. Now let's create an editor.

### Build an editor

See: [editor.js](https://github.com/substance/starter/blob/master/src/editor.js)

We're using React for our example, but be aware that you can use Substance with any other web framework, or not use a framework at all.

Our Editor component receives the document as an input. Now as a first step, our editor should be able to render the document passed in. We will set up a bit of Substance infrastructure first, most importantly a Substance Surface, that maps DOM selections to internal document selections.

#### Editor initialization

```js
this.surfaceManager = new Substance.Surface.SurfaceManager(doc);
this.clipboard = new Substance.Surface.Clipboard(this.surfaceManager, doc.getClipboardImporter(), doc.getClipboardExporter());
var editor = new Substance.Surface.ContainerEditor('body');
this.surface = new Surface(this.surfaceManager, doc, editor);
```

A Surface instance requires a `SurfaceManager`, which keeps track of multiple Surfaces and dispatches to the currently active one. It also requires an editor. There are two kinds of editors: A ContainerEditor manages a sequence of nodes, including breaking and merging of text nodes. A FormEditor by contrast allows you to define a fixed structure of your editable content. Furthermore we initialized a clipboard instance and tie it to the Surface Manager.

We also setup a registry for components (such as Paragraph) and tools (e.g. EmphasisTool, StrongTrool). Our editor will then be able to dynamically retrieve the right view component for a certain node type.


We also need to hook into `componentDidMount` to attach our Surface and clipboard to the corresponding DOM elements as soon as they get available.

```js
componentDidMount() {
  var doc = this.props.doc;

  doc.connect(this, {
    'document:changed': this.onDocumentChanged
  });

  this.surfaceManager.registerSurface(this.surface, {
    enabledTools: ENABLED_TOOLS
  });

  this.surface.attach(this.refs.bodyNodes.getDOMNode());

  this.surface.connect(this, {
    'selection:changed': this.onSelectionChanged
  });

  this.clipboard.attach(React.findDOMNode(this));


  this.forceUpdate(function() {
    this.surface.rerenderDomSelection();
  }.bind(this));
}
```

We bind some event handlers:

  - `onDocumentChange` to trigger an editor rerender if the container changes (a node is added or removed)
  - `onSelectionChanged` to update the tools based on the new document selection

We'll look into those handler implementations later. First, let's render our document. 

```js
render() {
  var doc = this.props.doc;
  var containerNode = doc.get('body');
  var components = [];

  components = components.concat(containerNode.nodes.map(function(nodeId) {
    var node = doc.get(nodeId);
    var ComponentClass = this.componentRegistry.get(node.type);
    return $$(ComponentClass, { key: node.id, doc: doc, node: node });
  }.bind(this)));

  return $$('div', {className: 'editor-component'},
    $$('div', {className: 'toolbar'},
      $$(ToolComponent, { tool: 'emphasis', title: 'Emphasis', classNames: ['button', 'tool']}, "Emphasis"),
      $$(ToolComponent, { tool: 'strong', title: 'Strong', classNames: ['button', 'tool']}, "Strong")
    ),
    $$('div', {className: 'body-nodes', ref: 'bodyNodes', contentEditable: true, spellCheck: false},
      components
    )
  );
}
```

Essentially what we do is iterating over all nodes of our body container, determining the ComponentClass and constructing a React.Element from it. We also provided a simple toolbar, that has annotation toggles. We will learn more about tools later when we implement a custom tool for our editor.


### Anatomy of a Substance Document


TODO: describe 

- Nodes
- Properties
- Containers


### Transactions

When you want to update a document, you should wrap all your changes in a transaction, so you don't end up in inconsistent in-between states. The API is fairly easy:

```js
doc.transaction(function(tx) {
  tx.delete("em2"); // deletes an emphasis annotation with id em2
});
```

```js
var updated = "Hello world!";
doc.transaction(function(tx) {
  tx.set([text_node_1, "content"], updated); // updates content property of node text_node_1
});
```

## Rules that make your life easier:

- Content tools must bind to mousedown instead of click to handle toggling.
  That way we can prevent the blur event to be fired on the surface.
- The root element of a Substance Surface must be set contenteditable


## Development

### Testing

1. Running the QUnit test-suite in a browser for debugging:

```
$ node test/serve
```

Then open http://localhost:4201 in your browser.

2. Running test-suite using Karma to generate a code coverage report.

```
$ karma start test/karma.conf.js
```

The report will be stored in the `coverage` folder.
