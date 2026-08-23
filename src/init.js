/**
 * @file `thornweave init` — scaffold a new story with a commented starter.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TEMPLATE = `---
title: A New Story
author: Your Name
start: Arrival
show: coins
vars:
  coins: 3
---

%% Welcome to Thornweave. This file is a complete, playable story.
%% Edit anything; recompile often:
%%   thornweave play mystory.thorn

== Arrival ==
You arrive at the crossroads with {{coins}} coins in your pocket.

The road east is paved. The road north is not.

* Take the paved road east -> Town
* (once) Check your pockets -> Pockets
* Follow the unpaved road north -> Hills

%% A passage used only as reusable text: splice it with {{include Signpost}}

== Pockets [ending] ==
Three coins, a bus ticket from a town you have never visited,
and a pebble warm from your hand. Enough for one honest decision.

== Town ==
The toll is two coins.

~ set coins = coins - 2

{{if coins >= 1}}
One coin left, and the whole evening ahead.
[[Keep walking -> Square]]
{{else}}
The tollkeeper waves you through anyway. "Tell them Vess sent you."
[[Nod and pass -> Square]]
{{end}}

== Square ==
Lamplighters count their lamps here at dusk.

%% Reusable fragment — splice other passages with {{include Name}}:
{{include Signpost}}

[[Take the hill path out of town -> Hills]]

== Hills [ending] ==
The path switchbacks twice before the town becomes a map beneath you.

== Signpost ==
The signpost lists three places and lies about the distances.
`;

export async function cmdInit(flags, c) {
  const dir = flags._[0];
  if (!dir) {
    console.error('usage: thornweave init <directory>');
    return 2;
  }
  if (existsSync(dir) && existsSync(join(dir, 'mystory.thorn'))) {
    console.error(c.amber(`${dir} already contains mystory.thorn — leaving it alone`));
    return 2;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mystory.thorn'), TEMPLATE, 'utf8');
  console.log(c.green(`created ${join(dir, 'mystory.thorn')}`));
  console.log('');
  console.log('next steps:');
  console.log(`  ${c.cyan(`thornweave compile ${dir}\\mystory.thorn`)}`);
  console.log(`  ${c.cyan(`thornweave play ${dir}\\mystory.thorn`)}`);
  return 0;
}
