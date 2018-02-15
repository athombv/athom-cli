# Athom CLI

This is the Command Line Interface for Homey App Development.

## Installation

```bash
$ npm install -g athom-cli@2
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

$ athom homey list
$ athom homey select
$ athom homey unselect
```