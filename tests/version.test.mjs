import test from 'node:test';
import assert from 'node:assert/strict';
import {older} from '../src/lib/version.ts';
test('desktop versions compare by number, not as text',()=>{
 assert.equal(older('0.2.0','0.10.0'),true);
 assert.equal(older('0.10.0','0.2.0'),false);
 assert.equal(older('1.0.0','1.0.0'),false);
 assert.equal(older('0.9.9','1.0.0'),true);
 assert.equal(older('1.2.3','0.0.0'),false,'the default minimum lets every version through');
});
