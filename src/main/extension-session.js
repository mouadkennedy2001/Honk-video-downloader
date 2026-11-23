'use strict';

const { session } = require('electron');

const BROWSER_PARTITION = 'persist:wasel-browser';

function getSession() {
  return session.fromPartition(BROWSER_PARTITION);
}

module.exports = {
  getSession
};
