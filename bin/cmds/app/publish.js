'use strict';

const Log = require('../../..').Log;
const App = require('../../..').App;
const colors = require('colors');

exports.desc = 'Publish a Homey App to the Homey Apps Store';
exports.handler = async yargs => {

  let appPath = yargs.path || process.cwd();

  try {
    let app = new App( appPath );
    await app.publish();
  } catch( err ) {
    Log(colors.red(err.message));
  }

}