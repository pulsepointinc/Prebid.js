/**
 * @file yieldbot adapter
 */
var utils = require('../utils'),
    adloader = require('../adloader'),
    bidmanager = require('../bidmanager'),
    bidfactory = require('../bidfactory');

function YieldbotAdapter() {

  var toString = Object.prototype.toString,
      hasOwnProperty = Object.prototype.hasOwnProperty,
      ybq = window.ybotq || (window.ybotq = []),
      t_Arr = 'Array',
      t_Str = 'String',
      t_Fn = 'Function',
      bidmap = {};

  // constants
  var YB = 'YIELDBOT',
      YB_URL = '//cdn.yldbt.com/js/yieldbot.intent.js',
      CREATIVE_TEMPLATE = "<script type='text/javascript' src='" +
        YB_URL + "'></script><script type='text/javascript'>var ybotq=ybotq||[];" +
        "ybotq.push(function(){yieldbot.renderAd('%%SLOT%%:%%SIZE%%');})" +
        "</script>";

  /**
   * Return if the object is of the
   * given type.
   * @param {*} object to test
   * @param {String} _t type string (e.g., Array)
   * @return {Boolean} if object is of type _t
   */
  function isA(object, _t) {
    return toString.call(object) === '[object ' + _t + ']';
  }

  /**
   * Return if the object is "empty";
   * this includes falsey, no keys, or no items at indices
   * @param {*} object object to test
   * @return {Boolean} if object is empty
   */
  function isEmpty(object) {
    if (!object) return true;
    if (isA(object, t_Arr) || isA(object, t_Str)) return !(object.length > 0);
    for (var k in object) {
      if (hasOwnProperty.call(object, k)) return false;
    }
    return true;
  }

  /**
   * Iterate object with the function
   * falls back to es5 `forEach`
   * @param {Array|Object} object
   * @param {Function(value, key, object)} fn
   */
  function _each(object, fn) {
    if (isEmpty(object)) return;
    if (isA(object.forEach, t_Fn)) return object.forEach(fn);

    var k = 0,
        l = object.length;

    if (l > 0) {
      for (; k < l; k++) fn(object[k], k, object);
    } else {
      for (k in object) fn(object[k], k, object);
    }
  }

  var yb = {

    /**
     * basic template: %%MY_VAR_TO_TPL%%
     */
    tplRxp: /%%(\w+)%%/g,

    /**
     * Normalize a size; if the user gives us
     * a dim array, produce a wxh string
     * @param {String|Array} size
     * @return {String} WxH string
     */
    formatSize: function (size) {
      return isA(size, t_Arr) ? size.join('x') : size;
    },

    /**
     * Return a creative from its template
     * @param {String} slot -- this is the yieldbot slot code
     * @param {String|Array} size that the bid was for
     * @return {String} the creative's HTML
     */
    creative: function (slot, size) {

      var args = {
        slot: slot,
        size: yb.formatSize(size),
      };

      return CREATIVE_TEMPLATE.replace(yb.tplRxp, function ($0, $1) {
        return args[($1 || '').toLowerCase()];
      });
    },

    /**
     * Produce a bid for our bidmanager,
     * set the relevant attributes from
     * our returned yieldbot string
     * @param {String} yieldBotStr the string from yieldbot page targeting
     * @return {Bid} a bid for the bidmanager
     */
    makeBid: function (placement, slot, params) {
      var dim = params.ybot_size.split('x'),
          bid = bidfactory.createBid(1);

      bid.bidderCode = 'yieldbot';
      bid.width = parseInt(dim[0]);
      bid.height = parseInt(dim[1]);
      bid.code = slot;
      bid.size = params.ybot_size;
      bid.cpm = parseInt(params.ybot_cpm) / 100.0;
      bid.ad = yb.creative(slot, params.ybot_size);
      bid.placementCode = placement;
      return bid;
    },

    /**
     * Add a slot to yieldbot (to request a bid)
     * @param {Bid} bid this should be a bid from prebid
     */
    registerSlot: function (bid) {
      ybq.push(function () {
        bidmap[bid.params.name] = bid.placementCode;
        yieldbot.defineSlot(bid.params.name, {
          sizes: bid.params.sizes
        });
      });
    }
  };

  function addErrorBid(placementCode, yslot, params) {
    var bid = bidfactory.createBid(2);
    bid.bidderCode = 'yieldbot';
    bid.placementCode = placementCode;
    bid.code = yslot;
    bid.__raw = params;

    utils.logError('invalid response; adding error bid: ' + placementCode, YB);
    bidmanager.addBidResponse(placementCode, bid);
  }

  /**
   * Handle the response from yieldbot;
   * this is pushed into the yieldbot queue
   * after we set up all of the slots.
   */
  function responseHandler() {
    _each(bidmap, function (placementCode, yslot) {
      // get the params for the slot
      var params = yieldbot.getSlotCriteria(yslot);

      if (!params || ((params || {}).ybot_ad === 'n')) {
        return addErrorBid(placementCode, yslot, params);
      }

      bidmanager.addBidResponse(placementCode, yb.makeBid(placementCode, yslot, params));
    });
  }

  /**
   * @public call bids; set the slots
   * for yieldbot + add the publisher id.
   * @param {Object} params
   * @param {Array<Bid>} params.bids the bids we want to make
   */
  function _callBids(params) {
    // download the yieldbot intent tag
    adloader.loadScript(YB_URL);

    _each(params.bids, function (bid, i) {

      if (!bid.params) {
        utils.logError("invalid bid!", YB);
        return;
      }

      // normalize the bid & fallback onto the slot
      // for the sizes; in case they said `code`, make it `name`
      bid.params.sizes = isEmpty(bid.params.sizes) ? bid.sizes : bid.params.sizes;
      bid.params.name = bid.params.name || bid.params.code;

      // on the first bid,
      // set the yieldbot publisher id
      if (i === 0) {
        if (!bid.params.pub) {
          utils.logError("no publisher id provided!", YB);
          return;
        }

        ybq.push(function(){ yieldbot.pub(bid.params.pub);});
      }

      yb.registerSlot(bid);
    });

    ybq.push(function () {
      yieldbot.enableAsync();
      yieldbot.go();
    });

    ybq.push(responseHandler);
  }

  return {
    callBids: _callBids
  };
}

module.exports = YieldbotAdapter;
