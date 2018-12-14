# MakeTime

Make-time is an opinionated email client for Gmail. See help.js for more details.

## Build dependencies
1. Checkout https://github.com/ojanvafai/make-time
2. npm install
  ^^^^ This installs type script and firebase
3. Use an editor of your choosing, although Visual Studio Code works particularly well with typescript integration. See https://stackoverflow.com/posts/30319507/revisions.

Starting a dev server:
$ cd make-time
$ ./node_modules/firebase-tools/lib/bin/firebase.js serve

Now http://localhost:5000 serves make-time the same as consumer. For google.com credentials, use --port 5555 to serve from localhost:5555.

Deploying:
$ cd make-time
$ ./deploy.sh --help

The help will print out a usage that is the actual deploy command you should run. In order to deploy, Ojan
will need to make you a collaborator on the relevant appengine projects first though, so give him your
personal Google address to use for that.

Navigating the code:
index.html is the file that gets served, but it basically just loads main.js, which in turn loads everything
else as ES Modules. the onLoad() method in main.js is a good starting place to see how the page boots up, or
the router.add calls to see how the different routes get initialized.
