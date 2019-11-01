# Athom CLI

This is the Command Line Interface for Homey App Development.

## Installation

```bash
$ npm install -g athom-cli
```

## Usage

```bash
$ athom --help
athom <command>

Commands:
  athom app      App related commands
  athom homey    Homey related commands
  athom ledring  LED ring related commands
  athom login    Log in with an Athom Account
  athom logout   Log out the current user

Options:
  --version  Show version number
  --help     Show help
```

### Examples

```bash
$ athom login

$ athom app create

$ athom app validate
$ athom app validate --level appstore

$ athom app run
$ athom app run --clean
$ athom app run --path /path/to/my/app/folder
$ athom app install
$ athom app version patch
$ athom app build

$ athom app driver create

$ athom homey list
$ athom homey select
$ athom homey unselect
```

## Plugins

Athom CLI ships with built-in plugins to make the development workflow easier. Plugins must be defined in `/.homeyplugins.json` in your app's root, and are executed in order.

### Compose
The `compose` plugin copies & merges files, which is useful for very large Homey Apps.

For documentation, refer to [AppPluginCompose](lib/AppPluginCompose/index.js).

### Z-Wave
The `zwave` plugin installs [homey-meshdriver](https://www.npmjs.com/package/homey-meshdriver).

For documentation, refer to [AppPluginZwave](lib/AppPluginZwave/index.js).

### Zigbee
The `zigbee` plugin installs [homey-meshdriver](https://www.npmjs.com/package/homey-meshdriver).

For documentation, refer to [AppPluginZigbee](lib/AppPluginZigbee/index.js).

### RF
The `rf` plugin installs [homey-rfdriver](https://www.npmjs.com/package/homey-rfdriver), and copies pairing templates to `/.homeycompose/`.

For documentation, refer to [AppPluginRF](lib/AppPluginRF/index.js).

### Log
The `log` plugin installs [homey-log](https://www.npmjs.com/package/homey-log). You must still require the module in the app yourself:

```
const { Log } = require('homey-log');
```

Don't forget to add the `HOMEY_LOG_URL` variable to your `env.json`.