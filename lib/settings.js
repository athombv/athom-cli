var fs			= require('fs-extra');
var path		= require('path-extra');
var jsop		= require('jsop');

var datadir = path.datadir('com.athom.athom-cli');
var datafile = path.join( datadir, 'settings.json' );

fs.ensureDirSync(datadir);

global.settings = jsop(datafile);