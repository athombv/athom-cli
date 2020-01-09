'use strict';

const { promisify } = require('util');
const fs = require('fs');
const _path = require('path');

const exec = promisify(require('child_process').exec);
const statAsync = promisify( fs.stat );
const gitConfigParser = require('parse-git-config');

class GitCommands {
    constructor(appPath) {
      if (typeof appPath !== 'string') throw new Error('Expected path to execute git command in');
      this.path = appPath;
    }

    /**
     * Check if git is installed. By using --version git will not exit with an error code
     */
    static async isGitInstalled() {
        try {
            const {stdout, stderr} = await exec('git --version');
            return !!stdout;
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if the cwd is contains a git repo.
     * @param {String} path
     * @returns Boolean whether or not .git has been detected.
     */
    static async isGitRepo({path}) {
      try {
        await statAsync( _path.join(path, '.git' ) );
        return true;
      } catch (err) {
        return false
      }
    }

    /**
     * Check if the repository contains uncommitted changes
     * @returns Boolean, true if there are uncommitted changes detected.
     */
    async hasUncommittedChanges() {
        const result = await this._executeGitCommand('status');
        return typeof result === 'string' && (result.includes('not staged') || result.includes('untracked'));

    }

    /**
     * Create a git tag with the given version number and optional message.
     * @param{Object<{version, message}>} Version: Used for the tag name, message: The message to describe the tag.
     * @returns Git output or error when the command failed.
     */
    async createTag ({version, message}) {
        if (typeof version === 'string' && typeof message === 'string') {
            try {
                if (!version || version === '')
                    throw new Error('✖ A version is required to create a tag.');
                if (await this.hasUncommittedChanges())
                    throw new Error('✖ Please commit your changes to Git first.');

                const result = await this._executeGitCommand(`tag -a "v${version}" -m "${message}"`);

                if (result.hasOwnProperty('stderr') && result.stderr.includes('already'))
                    throw new Error('✖ This Git tag already exists!');
            } catch (error) {
                throw error;
            }
        }
        else {
            throw new Error('Invalid type received');
        }
    }

  /**
   * Method that pushes a newly created tag (version) to the remote.
   * @param {String} version
   * @returns {Promise<Git>}
   */
    async pushTag({version}) {
      if (typeof version !== 'string') throw new Error('Invalid type received');
      return this._executeGitCommand(`push origin v${version}`);
    }

    /**
     * Obtain all the tags from the given repository.
     * @returns Array with git tags.
     *  */
    async getTags() {
        const output = await this._executeGitCommand(`tag -l`);

        // Create an array based on line breaks, then filter any empty String out of it.
        return output.split(/\r\n|\r|\n/).filter(value => {
            if (value) return value;
        });
    }

    /**
     * Deletes a tag from the given repository.
     * @param version version string to delete
     * @returns Output from @_executeGitCommand
     */
    async deleteTag(version) {
        if (typeof version === 'string') return this._executeGitCommand(`tag -d ${version}`);
        return new Error('Invalid type received');
    }

    /**
     * Commit a given file.
     * @param {Object<{file, message, description}>} File: the file to commit, message: Commit message, description: Commit description
     * @returns Output from @_executeGitCommand
     */
    async commitFile({file, message, description}) {
      if (typeof file !== 'string' || typeof message !== 'string') throw new Error('Invalid file or message type received');
      return this.commitFiles({files: [file], message, description});
    }

    /**
     * Commit an Array of files.
     * @param {Object<{files, message, description}>} Files: array of files to commit, message: Commit message, description: Commit description
     * @returns Output from @_executeGitCommand
     */
    async commitFiles({files, message, description}) {
      if (files instanceof Array && typeof message === 'string') {
        await this._executeGitCommand(`add ${files.join(' ')}`); // Make sure untracked files are added first
        return this._executeGitCommand(`commit -o ${files.join(' ')} -m "${message}" ${typeof description === 'string' ? `-m "${description}"` : ''}`);
      }
      return new Error('Invalid type received');
    }

  /**
   * Method that checks if a remote origin is present.
   * @returns {Promise<void>}
   */
  async hasRemoteOrigin() {
    const gitConfig = await gitConfigParser({ path: _path.join(this.path, '.git', 'config') });
    // Always push to remote origin by default to prevent complicated configs.
    return gitConfig.hasOwnProperty('remote "origin"')
  }

  /**
   * Method that checks if a remote origin is present and if so pushes currently staged changes to that remote.
   * @returns {Promise<>}
   */
  async push() {
    if (!await this.hasRemoteOrigin()) throw new Error('✖ Cannot push to remote: \`remote "origin"\` not found in Git config.');
    return this._executeGitCommand('push');
  }

    /**
     * Function to execute git commands.
     * @param command: Git command to execute, eg commit, tag, push etc.
     * @returns Git command output or error when command failed.
     *  */
    async _executeGitCommand(command) {
      if (typeof this.path !== 'string') throw new Error('Expected path to execute git command in');
      if (! await GitCommands.isGitInstalled()) throw new Error('Git is not installed');

      try {
        const { stdout, stderr } = await exec(`git ${command}`, { cwd: this.path });
        return stdout;
      } catch(error) {
        console.log(error);
        throw error;
      }
    }
}

module.exports = GitCommands;
