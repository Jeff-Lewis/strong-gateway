var loopback = require('loopback');
var boot = require('loopback-boot');

var http = require('http')
  , https = require('https')
  , path = require('path')
  , httpsRedirect = require('./middleware/https-redirect')
  , site = require('./site')
  , sslCert = require('./private/ssl_cert');

var httpsOptions = {
  key: sslCert.privateKey,
  cert: sslCert.certificate
};

var app = module.exports = loopback();

// Set up the /favicon.ico
app.middleware('initial', loopback.favicon());

// request pre-processing middleware
app.middleware('initial', loopback.compress());

app.middleware('session', loopback.session({ saveUninitialized: true,
  resave: true, secret: 'keyboard cat' }));

// -- Add your pre-processing middleware here --

// boot scripts mount components like REST API
boot(app, __dirname);

// Redirect http requests to https
var httpsPort = app.get('https-port');
app.use('routes', httpsRedirect({httpsPort: httpsPort}));

var oauth2 = require('loopback-component-oauth2')(
  app, {
    dataSource: app.dataSources.db, // Data source for oAuth2 metadata persistence
    loginPage: '/login', // The login page url
    loginPath: '/login' // The login processing url
  });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Set up login/logout forms
app.get('/login', site.loginForm);

app.get('/logout', site.logout);
app.get('/account', site.account);
app.get('/callback', site.callbackPage);


// -- Mount static files here--
// All static middleware should be registered at the end, as all requests
// passing the static middleware are hitting the file system
// Example:
//   app.use(loopback.static(path.resolve(__dirname', '../client')));

oauth2.authenticate(['/protected', '/api', '/me'], {session: false, scope: 'demo'});

app.get('/me', function(req, res, next) {
  // req.authInfo is set using the `info` argument supplied by
  // `BearerStrategy`.  It is typically used to indicate scope of the token,
  // and used in access control checks.  For illustrative purposes, this
  // example simply returns the scope in the response.
  res.json({ user_id: req.user.id, name: req.user.username,
    accessToken: req.authInfo.accessToken });
});

signupTestUserAndApp();

var rateLimiting = require('./middleware/rate-limiting');
app.use('routes:after', rateLimiting({limit: 100, interval: 60000}));

var proxy = require('./middleware/proxy');
var proxyOptions = require('./middleware/proxy/config.json');
app.use('routes:after', proxy(proxyOptions));

app.use(loopback.static(path.join(__dirname, '../client/public')));
app.use('/admin', loopback.static(path.join(__dirname, '../client/admin')));

// Requests that get this far won't be handled
// by any middleware. Convert them into a 404 error
// that will be handled later down the chain.
app.use('final', loopback.urlNotFound());

// The ultimate error handler.
app.use('final', loopback.errorHandler());

app.start = function() {
  var port = app.get('port');

  http.createServer(app).listen(port, function() {
    console.log('Web server listening at: %s', 'http://localhost:3000/');
    https.createServer(httpsOptions, app).listen(httpsPort, function() {
      app.emit('started');
      console.log('Web server listening at: %s', app.get('url'));
    });
  });

};

// start the server if `$ node server.js`
if (require.main === module) {
  app.start();
}

function signupTestUserAndApp() {
// Create a dummy user and client app
  app.models.User.create({username: 'bob',
    password: 'secret',
    email: 'foo@bar.com'}, function(err, user) {

    if (!err) {
      console.log('User registered: username=%s password=%s',
        user.username, 'secret');
    }

    // Hack to set the app id to a fixed value so that we don't have to change
    // the client settings
    app.models.Application.beforeSave = function(next) {
      this.id = 123;
      this.restApiKey = 'secret';
      next();
    };
    app.models.Application.register(
      user.id,
      'demo-app',
      {
        publicKey: sslCert.certificate
      },
      function(err, demo) {
        if (err) {
          console.error(err);
        } else {
          console.log('Client application registered: id=%s key=%s',
            demo.id, demo.restApiKey);
        }
      }
    );

  });
}
