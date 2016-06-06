var fs			= require('fs-extra');
var path		= require('path-extra');

var datadir = path.datadir('com.athom.athom-cli');
var datafile = path.join( datadir, 'settings.json' );

fs.ensureDirSync(datadir);

if (Object.observe) {
	var jsop		= require('jsop');

	global.settings = jsop(datafile);
} else if (typeof Proxy === 'function') {
	fs.ensureFileSync(datafile);

	var writeDebounce = false;
	var settingsFile = fs.readFileSync(datafile);
	global.settings = new Proxy(String(settingsFile) ? JSON.parse(settingsFile) : {}, {
		// If the settings object is accessed (for read or write) check for changes
		get: function (target, property) {
			// Check if there already is a function on process.nextTick
			if (!writeDebounce) {
				writeDebounce = true;
				// On next tick check to write setting changes
				process.nextTick(function () {
					writeDebounce = false;
					const jsonString = JSON.stringify(target, null, 2);
					// If json is updated, write to file
					if (jsonString !== settingsFile) {
						settingsFile = jsonString;
						fs.outputFileSync(datafile, settingsFile);
					}
				});
			}

			return target[property];
		}
	});
} else {
	throw new Error('Sorry, you are using an unsupported Node.js version. Please update Node.js and try again.');
}