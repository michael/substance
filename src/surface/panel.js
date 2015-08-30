'use strict';

var Substance = require("../basics");

// Mixin with helpers to implement a scrollable panel
function Panel() {
}

Panel.Prototype = function() {

  this.getPanelOffsetForElement = function(el) {
    // initial offset
    var offset = 0;

    // TODO: Why is this.getScrollableContainer() not working here?
    var panelContentEl = this.getScrollableContainer();

    // Now look at the parents
    function addParentOffset(el) {
      var parentEl = el.parentNode;

      // Reached the panel or the document body. We are done.
      if ($(el).hasClass('panel-content-inner') || !parentEl) return;

      // Found positioned element (calculate offset!)
      if ($(el).css('position') === 'absolute' || $(el).css('position') === 'relative') {
        offset += $(el).position().top;
      }
      addParentOffset(parentEl);
    }

    addParentOffset(el);
    return offset;
  };

  this.scrollToNode = function(nodeId) {
    // var n = this.findNodeView(nodeId);
    // TODO make this generic
    var panelContentEl = this.getScrollableContainer();

    // Node we want to scroll to
    var targetNode = $(panelContentEl).find("*[data-id="+nodeId+"]")[0];

    if (targetNode) {
      $(panelContentEl).scrollTop(this.getPanelOffsetForElement(targetNode));
    } else {
      console.warn(nodeId, 'not found in scrollable container');
    }
  };

};

Substance.initClass(Panel);
module.exports = Panel;


