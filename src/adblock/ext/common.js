/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-present eyeo GmbH
 *
 * Adblock Plus is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Plus is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Plus.  If not, see <http://www.gnu.org/licenses/>.
 */

"use strict";

self.ext = {};

ext._EventTarget = class EventTarget
{
  constructor()
  {
    this._listeners = new Set();
  }

  addListener(listener)
  {
    this._listeners.add(listener);
  }

  removeListener(listener)
  {
    this._listeners.delete(listener);
  }

  _dispatch(...args)
  {
    let results = [];
    for (let listener of this._listeners)
      results.push(listener(...args));
    return results;
  }
};

/* Message passing */
ext.onMessage = new ext._EventTarget();
