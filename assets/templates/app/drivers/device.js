'use strict';

const Homey = require('homey');

class MyDevice extends Homey.Device {
	
	onInit() {
		this.log('MyDevice has been inited');
	}
	
}

module.exports = MyDevice;