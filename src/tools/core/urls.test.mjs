import test from 'node:test';
import assert from 'node:assert/strict';
import {publicProductUrl} from './urls.mjs';
test('portable product paths export as absolute preview or production URLs',()=>{
  const href='/ulichnaya-mebel/lavochki-i-skameyki/skamya-park/';
  assert.equal(publicProductUrl(href,'https://koleaw.github.io/SMU1/'),`https://koleaw.github.io/SMU1${href}`);
  assert.equal(publicProductUrl(href,'https://smu1.example/'),`https://smu1.example${href}`);
  assert.equal(publicProductUrl(href,'https://smu1.example/catalog'),`https://smu1.example/catalog${href}`);
});
