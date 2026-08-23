/**
 * @file Pratt expression parser for Thornmark expressions (SPEC §5).
 */
import { tokenizeExpr, parseErr } from './lexer.js';

export class ExprParser {
  constructor(toks) {
    this.toks = toks;
    this.i = 0;
  }
  peek() { return this.toks[this.i]; }
  next() { return this.toks[this.i++]; }
  isOp(v) { const t = this.peek(); return t.k === 'op' && t.v === v; }
  isKw(v) { const t = this.peek(); return t.k === 'kw' && t.v === v; }

  parse() { return this.ternary(); }

  ternary() {
    const c = this.or();
    if (this.isOp('?')) {
      this.next();
      const a = this.ternary();
      if (!this.eat(':')) throw parseErr("expected ':' in conditional expression", this.peek().pos);
      const b = this.ternary();
      return { t: 'ternary', c, a, b, pos: c.pos };
    }
    return c;
  }
  eat(a, b) {
    const t = this.peek();
    if (b === undefined) {
      if (t.k === 'op' && t.v === a) { this.i++; return true; }
      return false;
    }
    if (t.k === a && t.v === b) { this.i++; return true; }
    return false;
  }
  or() {
    let l = this.and();
    while (this.isKw('or') || this.isOp('||')) {
      const pos = this.next().pos;
      l = { t: 'bin', op: 'or', l, r: this.and(), pos };
    }
    return l;
  }
  and() {
    let l = this.not();
    while (this.isKw('and') || this.isOp('&&')) {
      const pos = this.next().pos;
      l = { t: 'bin', op: 'and', l, r: this.not(), pos };
    }
    return l;
  }
  not() {
    if (this.isKw('not') || this.isOp('!')) {
      const tok = this.next();
      return { t: 'un', op: 'not', e: this.not(), pos: tok.pos };
    }
    return this.cmp();
  }
  cmp() {
    let l = this.add();
    for (;;) {
      const t = this.peek();
      if (t.k === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.v)) {
        this.next();
        l = { t: 'bin', op: t.v, l, r: this.add(), pos: t.pos };
      } else return l;
    }
  }
  add() {
    let l = this.mul();
    for (;;) {
      const t = this.peek();
      if (t.k === 'op' && (t.v === '+' || t.v === '-')) {
        this.next();
        l = { t: 'bin', op: t.v, l, r: this.mul(), pos: t.pos };
      } else return l;
    }
  }
  mul() {
    let l = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.k === 'op' && ['*', '/', '%'].includes(t.v)) {
        this.next();
        l = { t: 'bin', op: t.v, l, r: this.unary(), pos: t.pos };
      } else return l;
    }
  }
  unary() {
    if (this.isOp('-')) {
      const tok = this.next();
      return { t: 'un', op: '-', e: this.unary(), pos: tok.pos };
    }
    return this.postfix();
  }
  postfix() {
    let e = this.primary();
    while (this.isOp('(')) {
      if (e.t !== 'var') {
        throw parseErr('only named functions can be called', e.pos, { help: 'use functionName(arguments)' });
      }
      this.next();
      const args = [];
      if (!this.isOp(')')) {
        for (;;) {
          args.push(this.ternary());
          if (this.eat(',')) continue;
          break;
        }
      }
      if (!this.eat('op', ')')) throw parseErr("expected ')' after arguments", this.peek().pos);
      e = { t: 'call', name: e.name, args, pos: e.pos };
    }
    return e;
  }
  primary() {
    const t = this.peek();
    if (t.k === 'num') { this.next(); return { t: 'num', v: t.v }; }
    if (t.k === 'str') { this.next(); return { t: 'str', v: t.v }; }
    if (t.k === 'kw' && (t.v === 'true' || t.v === 'false')) { this.next(); return { t: 'bool', v: t.v === 'true' }; }
    if (this.eat('op', '(')) {
      const e = this.ternary();
      if (!this.eat('op', ')')) throw parseErr("expected ')' to close group", this.peek().pos);
      return e;
    }
    if (this.isOp('[')) {
      const pos = this.next().pos;
      const items = [];
      if (!this.isOp(']')) {
        for (;;) {
          items.push(this.ternary());
          if (this.eat(',')) {
            if (this.isOp(']')) break;
            continue;
          }
          break;
        }
      }
      if (!this.eat('op', ']')) throw parseErr("expected ']' to close list", this.peek().pos);
      return { t: 'list', items, pos };
    }
    if (t.k === 'ident') {
      this.next();
      return { t: 'var', name: t.v, pos: t.pos };
    }
    throw parseErr(
      t.k === 'eof' ? 'expression ends unexpectedly' : `unexpected ${t.k} '${t.v}' in expression`,
      t.pos,
      { help: 'write an expression like gold >= 10 or has("key")' },
    );
  }
}
