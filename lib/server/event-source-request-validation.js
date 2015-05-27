var Router = require('routr');

module.exports = {

  accept: {
    prefixes: [ '/sse' ],
    headers:  [ 'text/event-stream', 'text/x-dom-event-stream' ],
    matchers: [ '/sse', '/sse/:channelName', '/sse/:channelName/:message' ],
    methods:  [ 'GET' ]
  },


  defaultChannelName: 'sse',


  getRouter: function () {
    var routerConfig = { };
    this.accept.matchers.forEach(function (path) {
      routerConfig[path] = {
        path: path,
        method: 'GET'
      };
    });
    return new Router(routerConfig);
  },


  matchStore: new WeakMap(),


  routeOnRequest: function (req) {
    return this.matchStore.get(req);
  },


  storeRouteOnRequest: function (route, request) {
    return this.matchStore.set(request, route);
  },


  getAcceptHeaderFromRequest: function (req) {
    req.headers = req.headers || {};
    return req.headers.accept || '';
  },


  getPathFromRequest: function (req) {
    var path = '';
    if (typeof req.path === 'function') {
      // You're probably using Restify
      path = req.path();
    } else if (typeof req.path === 'string') {
      path = req.path;
    }
    return path;
  },


  methodIsValid: function (req) {
    return !!~this.accept.methods.indexOf(req.method);
  },


  acceptHeaderIsValid: function (req) {
    var acceptHeader = this.getAcceptHeaderFromRequest(req);
    return this.accept.headers.some(function (acceptHeaderOption) {
      return !!~acceptHeader.indexOf(acceptHeaderOption);
    });
  },


  getRouteForPath: function (path) {
    return {
      name: path,
      url: path,
      params: {},
      config: {}
    };
  },


  prefixInPathIsValid: function (path) {
    return this.accept.prefixes.some(function (prefix) {
      return path.indexOf(prefix) === 0;
    });
  },


  routeForRequest: function (req, create) {
    var route = null;
    if ((route = this.routeOnRequest(req))) {
      return route;
    }

    var path   = this.getPathFromRequest(req);
    var router = this.getRouter();

    if (this.prefixInPathIsValid(path)){
      if (!create) {
        route = router.getRoute(path);
      } else {
        route = router.getRoute(path) || this.getRouteForPath(path);
      }
    }

    if (route != null) {
      this.storeRouteOnRequest(route, req);
    }

    return route;
  },


  isOkay: function isOkay(req, create) {
    var methodIsValid       = this.methodIsValid(req);
    var acceptHeaderIsValid = this.acceptHeaderIsValid(req);
    var route               = this.routeForRequest(req, create);

    (route && route.params) && (req.params = route.params);
    req.params || (req.params = {});
    req.params.channelName || (req.params.channelName = this.defaultChannelName);

    var ok = methodIsValid && acceptHeaderIsValid && route != null;

    ok && !global.TEST && console.info('Using channel name %s', req.params.channelName);

    return ok;
  }
};

