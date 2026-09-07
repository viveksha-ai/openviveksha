<!--
The Path of Viveksha — English edition.
Translated from the Russian original published on news.viveksha.ru:
https://news.viveksha.ru/put-vivekshi-paradigma-ii-agentov/
Cross-link to the Russian original is kept at the top and in the Links section.
-->

# The Path of Viveksha, or How I Built My Own AI-Agent Paradigm

> **TL;DR:** I built an AI-agent platform without looking at other builders — not out of pride, but because I was solving my own engineering problem: the agents were growing faster than the foundation could bear. Two paradigms were born. An engineering one — the *white box*: canvas, the Node Law, "what's connected is what works." And a human one — **the paradigm of intentions**: a human is no longer an operator; a human creates an intention. And an intention has no face. This week an agent assembled an agent on its own, a news site moved onto the canvas in an hour, and I open-sourced the platform's core.

> 🇷🇺 *The Russian original of this article lives on the site: [Путь Вивекши — news.viveksha.ru](https://news.viveksha.ru/put-vivekshi-paradigma-ii-agentov/).*

A quick word for those who just arrived: my name is Sergey, and I'm building **Viveksha** — a platform where AI agents are assembled like a constructor: as nodes on a canvas where every connection is visible. This article is not about the product. It's about **why** the product turned out exactly the way it did — and why it looks like nothing you've seen before, not n8n, not Dify, not anything else.

⚠️ If unfamiliar words start showing up midway — node, edge, tool loop — scroll to the very bottom: there's a glossary. Two minutes, and you're on first-name terms with all of them.

## Act One. "Now I can do EVERYTHING!"

It all started with experiments around AI agents. January 2026, meeting the first versions of OpenClaw — and a clear understanding: this is exactly what I had been looking for for a long time. "Now I can do EVERYTHING!"

And off we went!!

Task analysis, first attempts at coding agents by hand — that's a long story, and we'll move the telling of it to the far end of the To-Do list. It's already crowded there.

## Act Two. Dominoes

Very soon I understood: the agent systems I was building were a monolith, hardcode and crutches. This can't go on. I needed a frontend on which to assemble my agents. Not because I personally needed it — because I understood it had to be reproducible.

Meanwhile the agents kept growing and accumulating complex machinery: semantic retrieval, embedding experiments, cognitive modules for different client situations, sales-funnel work. And at some point everything began to break and collapse.

Neither RFCs, nor strict modularity control, nor git helped. Nothing. The system had no foundation around which everything could snap together like a constructor.

I thought I had a problem with code. It turned out I had a problem with the foundation: a beautiful house without a base, and every new floor brought the collapse closer. I no longer remember how many times I had to roll entire directory branches back from Time Machine.

![A monolith under load: a house standing on its own roof](assets/monolith-domino.png)

And understand: every iteration of an agent was days upon days of grueling work. Experiments, tests, coding, hunting for solutions, more coding, more tests — and rebuilds from a blank slate.

## Act Three. The Canvas

The solution showed up almost by accident: React and its Canvas graph. It was exactly what I needed. Not because similar systems were built on the same thing — but because it was technically obvious.

And here's the canvas assembled, everything works, let's make nodes! We build MCP servers, hook them up — EVERYTHING WORKS!!!

Ha. If only it were that simple.

## Act Four. Day Two: the Node Law

On day two I understood that I needed the **Node Law** — only it would let me build a foundation: principles of how nodes interact.

By that point I already had some three or four forks — agent prototypes — and each of them worked and showed results. In each one simmered complex systems of semantic data selection — I have about three of them, from the simplest cosine (harmonic resonances) to wave resonators built out of embeddings; a cognitive engine I developed with eleven state axes, actively working in dialogs with humans; my own MCP servers with tools; various hardcodes for complex calculations and computations... And all of this had to be turned into... a constructor! A constructor made of nodes.

But what should a node even be? I understand exactly how my agents work: how they form a prompt, how they do semantic embedding selections to pick relevant data. I even understood how an LLM works on the inside, and put everything on shelves. But how do you turn that into a node?

Wrap it in a black box? And arrive at the same monolith with hardcode — except now the system would crumble not in one place but everywhere at once, like dominoes? No. I needed a **white box**: an exposed structure built from a bare minimum.

Around the eighth or ninth iteration I managed to write down the basic Node Laws. It was a very hard task. And — important — I barely studied the competitors. Not because I think I'm "better than everyone," but because I was solving my own engineering problem from inside the system. The solutions weren't born as responses to existing products, not as copy-paste of other people's ideas — they were an attempt to build a foundation that would bear my own complexity. A solution that would rid me of hardcode and let me replicate and scale agents.

Now I can say this honestly and without false modesty: I had neither Dify nor n8n in front of my eyes — and that's good. Had someone else's product been in front of me, sooner or later I would have taken it as the base. And then there would have been no Viveksha — there would have been a copy with a different button.

The result is a system that in many places turned out unlike the familiar agent builders — and in some ways even contradicts them.

An example. An edge in Viveksha is not a direction. It's an ID pointer inside the data body: data comes from there, and can go back there — only the **modality** decides. For example, the key Pipeline node (Role) that assembles the prompt: on input — raw text; on output — PROMPT. And that is not the same text at all: it's already a wrapper, inside which different modalities live. And so at every step — everything had to be thought through in advance, with scaling and universality built in from the start.

And where should chat history live? In the chat node? In the pipeline node? Or should it be a separate node that simply records everything flowing through it? I was trying to solve the scaling problem of my own agents — and I made history a separate node. Why? What if the agent isn't in an iteration loop? What if it doesn't need dialog memory and is linear? What if I need to export the history or hook up a compacting node? What if, what if...

**A node knows nothing about other nodes.** That's not a slogan. It's insurance against my own future hardcode.

That's how Viveksha was built.

## Act Five. Every Law Has Its Scar

"Node Law" — sounds nice, right? Anyone can write a manifesto. So let me be precise about what I mean by a law: a rule of graph execution that can be verified by a test. Every single one. And each has its own story. Its own scar. I'll show a few — the whole dozen is open in the [specification](https://github.com/viveksha-ai/openviveksha/blob/main/spec/laws.md).

**Scar one. A node started before its tools.** I'm assembling the canonical example from my own specification: role, tools, model. Everything by the book. And the answer comes back bare — without a single tool call. I look: the tools haven't even connected yet! And the node, which was only waiting for mandatory data, calmly started on half-data. A law was born: if your source hasn't executed yet — stand and wait, even if the input is optional. There's exactly one exception — the answer port, otherwise graphs with back-edges would suffocate on themselves. Sounds like a trifle? This "trifle" was killing tool-using agents in the single canonical example of the specification. Right in it — in the only one!

**Scar two. The loop you can't program.** First reflex: let's write a tool loop! A special node — call the model, call the tool, pass the result, repeat. And right there I stopped myself: how is this not the same monolith? A separate machine inside the machine — a black box inside a white one. The right answer turned out to be simpler and scarier: the loop is not programmed. The executor simply keeps running the graph while at least one node changes — and the cycle "think → act → look → think again" emerges by itself. From the law. The way the water cycle emerges from gravity.

**Scar three. An error that names names.** The graph produced no answer. What now? The usual answer: "error." My answer: name the port that wasn't awaited. Specifically. By name. Because a human reads the canvas — and diagnostics must be human. No "something went wrong."

**Scar four. Privacy as a law, not a checkbox.** Secrets are write-only: they can't be read through the API, can't be seen in a log, can't leak into a trace. Prompts in traces — as lengths and counts, but not content. A client has the right to privacy even from their own platform. Not a feature in the settings — a law.

**And now the question you've already asked:** how is this different from what you've seen? Honest answer, with names.

n8n is an integration conveyor: one pass from input to output, and you're lucky if a loop exists as a separate node. LangFlow and Dify are LangChain chains with little control: the loop is hidden inside an agent node — a black box inside a black box. Edges there are arrows: source → sink, rigid order.

In Viveksha — a ring. The executor runs the graph until a fixed point, while at least one node changes. The loop is a consequence of the law, not a feature. An edge is a wire, not an arrow: model and tool exchange data over one wire in both directions, and the order of node creation doesn't matter.

And here comes the most important part. A canvas where assembly order doesn't matter can be assembled not only by a human. An agent creates nodes in whatever order is convenient for it — and the graph is alive anyway. An arrow-conveyor can't do that: there you have to simulate human order. Remember "an agent assembled an agent"? Here's its foundation. Not glued on from above — grown from below.

**A reality check.** I'll be honest: when the system was already working, I did take nine builders apart into primitives — n8n, Make, Zapier, Dify, LangFlow, Flowise, ComfyUI, Activepieces, Power Automate. Not to copy — to check myself. The core matched almost verbatim: about thirty identical primitives — trigger, condition, loop, transformation, external call, code, LLM, tool. Competition is not in features: everyone has the same primitives. A product is not the primitives — it's how they're assembled and whether the assembly is visible. My path was validated not because I never saw the alternative, but because I saw it — and didn't want it.

Meet the foundation. Everything else stands on it.

## A lyrical digression. What the heck is "Viveksha"?

Strange name, right? VIVEKSHA — what is that? Let's look at Sanskrit.

**Vivekṣā** (विविक्षा) — "the desire to discern," the striving to recognize truth; a word cognate with *viveka* — "discernment, wisdom." Including — "intention": the word's implied meaning.

In the IT world, "Viveksha" is a metaphor for intention, autonomy, and the separation of truth and falsehood in an artificial mind: not text generation from a template, but an internal "meaning" and the drive to communicate and act.

That was the lyrical digression. But remember the word "intention" — it will fire later.

## Act Six. What's Connected Is What Works

This is possibly the most important law: **no hidden data layers**.

The canvas is not an illusion made of black boxes. It's transparent architecture, and a node here is not just an element of a graph: the node IS the code that executes.

Nodes know nothing about other nodes. What's connected is what works. Connections aren't directions — they're modality. Data isn't "input and output" — it's "before" and "after."

Every step of an agent's work is visible. Remove something — it stops working. There is no "magic under the hood" that cannot be opened.

And these are perhaps the most fundamental laws of all. And you know what? I didn't see them in similar systems from competitors. Not because I invented them — other systems simply work differently. Not worse, not better — just differently. And that's another unique trait of my system. But talking about uniqueness in a world where new projects appear every day is pointless: tomorrow any system can claim it has this too.

## Act Seven. The Paradigm of Intentions

And now — the main thing. What was this whole engineering odyssey even for? Not for the constructor. For the paradigm.

The future belongs to AI. That's no longer a thesis — it's the background. Meanwhile, until recently, the human was an operator: clicks, forms, tabs, pixels. [I wrote about this separately](https://news.viveksha.ru/intent-driven-runtime-paradigm-shift-2026-08-03/): the operator controls the interface, the interface controls the human.

The new paradigm is that **the human is not an operator. The human creates an intention.**

And this has been baked into Viveksha's concept from birth: it has two interfaces.

The **first** — for those used to being an operator: assemble the canvas yourself. Node by node, with your own hands, everything visible, convenient, accessible.

The **second** — state an intention. Your primary agent will fulfill it: it will assemble a subagent — a closed-loop agent that will perform the routine 24/7.

The same canvas, two paths. One difference: in the first case you draw the graph; in the second — you say what should be.

And now — the phrase I started this article for.

**An intention has no face.**

An intention doesn't care who fulfills it: you yourself, your primary agent, or a subagent assembled by your agent. It doesn't choose an executor — it demands a result. Remember Sanskrit? Intention is right there in the name. And now recall the headless core: it has no face not because a face was lacking — but because the face is redundant here. The platform adds the face. Agents do the execution. The intention is yours.

![An AI genie — executor of intentions: an intention has no face](assets/genie-intention.png)

What intention, you ask?

Before the AI era, humans wrote their own reports, went to the café for pizza themselves, programmed themselves — everything themselves. That was servicing the system.

Now, as humans step out of this chain and AI agents take their place, the human becomes a source of intentions. That's the paradigm awaiting all of us.

Where does Viveksha come in?

It becomes the missing link that births agents for intentions — a ready-made tool for the Agent to assemble an agent (a tautology? No!). It's very simple: first-level agents face a dilemma — either code your own agent to solve an intention's task, or use an open-source solution or a paid constructor. Or you don't delegate the coding at all — you assemble your own solution quickly. That's what Viveksha is for.

## Act Eight. The Two Days When Everything Became Real

A paradigm is beautiful, but a platform has to earn its living. The last two days are the two days when the system finally worked where it's really meant to work: in production. Let me just describe a couple of days from this story...

**Yesterday.** My agent-assistant (I call her Fox) assembled and fixed the production canvases herself — not in an editor, but through the MCP API, with tools. I didn't open the constructor. I opened a chat and asked. An agent assembled an agent. Funny: I was building a constructor on which agents assemble agents — and one day it simply worked. Rather, not quite!! I walked a long road to make this JUST work.

The result? On the internal Bitrix24 perimeter, the agent learned to do complex order calculations based on dialogs with clients. Before that it was a lead analyst at the level of a top manager — a real case of the system.

And before that, production tests caught a sneaky defect: a double loop — the platform was silently spending twice as many tokens as it should. We fixed one node by one law. That's exactly why the laws were written: the problem wasn't found by grepping all the code, but by reading a single violation of a rule.

**Today.** The news site news.viveksha.ru, which ran on one of Viveksha's prototype forks, was moved onto the Viveksha PRO constructor. We moved digest assembly onto the canvas — in an hour. Seven nodes: webhook, role, MCP tools, Ghost as the tool circuit. In the morning the site was run by a script; by evening — by an agent on a canvas, which you can look at as a diagram and rebuild in a couple of clicks. That's the second interface in action: I didn't draw the canvas with a mouse — I stated an intention, and the platform fulfilled it. An excellent case and a test of the whole construction.

**That same evening** I open-sourced the platform's core: [OpenViveksha](https://github.com/viveksha-ai/openviveksha) under Apache-2.0 with a brand caveat. Along the way, verification caught two critical bugs that had passed twenty tests out of twenty — green tests, a dead tool loop. We fixed it honestly: there are now 23 tests, and they run the real wiring, not stubs. CI is green — another small victory.

Two productive days. If a month ago someone had told me a news site would be run by an agent assembled by an agent, and that the constructor's core would be open-sourced on GitHub — I'd have asked for a link to the dashboard where this "already works."

## Denouement. An Intention Has No Face

The whole paradigm I suffered through is no longer an internal kitchen but an open specification: [OpenViveksha on GitHub](https://github.com/viveksha-ai/openviveksha) — canvas, node laws, minimal core. Read the laws — they're shorter than this article. After them, the canvas will stop being magic.

The open core is headless. It has no face. And that's not a bug and not laziness — it's the same paradigm of intentions taken to the limit: remove the face, so the essence remains. The canvas as code. The laws as a contract. The executor — anyone: your AI client, your agent, your script.

The full platform — with cabinets, harmonics, the cognitive layer, channels and a face — lives at [viveksha.ru](https://viveksha.ru), its documentation is open at [viveksha.ru/docs](https://viveksha.ru/docs).

What's next? The next chapter of this story is already being written. Just not by me.

By agents. Who will start with an intention — just like we did.

Who is this whole article for?

For the same crazies as me. For those to whom my paradigm of intentions is clear — and for whom it's already a tsunami on the horizon. For those who get interested in my project: not just to put a star on GitHub, but to join the project and start creating your own nodes, your own graphs, your own complex agent systems for any intentions.

## Glossary. The confusing words, now clear

In order of appearance.

**Node** — a cell of the graph (the graphical engine), one step of an agent's work: model, memory, tools, channel. Agents are assembled from nodes as if from bricks.

**Canvas** — a diagram of nodes and connections. The whole agent, on one screen.

**Edge (wire)** — a connection between nodes. In Viveksha it's not an arrow but a wire: nodes publish to it and read from it.

**Port** — a node's input or output through which it reads and publishes data.

**Modality** — the type and meaning of the data on a port: raw text, an assembled prompt, a list of tools. Examples of modalities: text, image, video file...

**Prompt (PROMPT)** — what the model receives: instruction, dialog history, list of available tools. What you type into ChatGPT is part of a prompt: your request, to which the LLM responds.

**Node Law** — a graph-execution rule verifiable by a test. Not a slogan: a violation of a law must be catchable.

**Tool loop** — the cycle "the model asks a tool → the tool answers → the model keeps thinking."

**Ring, fixed point** — the executor repeats graph runs while the graph keeps changing; the graph "settled" — the answer is ready.

**Embedding** — representing text as a vector of numbers; meaning is searched this way, not word matches. An embedding also lives inside an LLM: when a prompt enters the model, it becomes a high-dimensional vector — the direction of token entry — which shapes the model's response.

**Semantic retrieval** — selecting data by meaning (via embeddings), not by keywords.

**MCP** — an open protocol through which an agent connects external tools.

**RFC** — an engineering proposal: first the design is agreed on paper, then the code is written. Like a blueprint before construction.

**git** — a version control system: who changed what in the code, and when.

**Stub** — a mock in tests, an imitation of a real component. A dangerous thing: tests are green, but the real wiring is untested.

**Grep** — text search across the entire codebase at once.

**OpenClaw** — an environment for autonomous AI agents; everything started with meeting it.

**Ghost** — the news site engine (CMS). For a Viveksha agent — just a set of tools over a protocol.

**Headless** — "without a head": a core without an interface, execution only.

**Subagent (closed-loop agent)** — an agent assembled by another agent, working autonomously, without a human.

**CI** — automated code checks on GitHub: tests run on every commit.

**Apache-2.0** — an open license: the code can be used, modified, and sold — with attribution preserved.

**Fox** — my agent-assistant living in OpenClaw. She assembled the first agent before I did. Not just an agent but the orchestrator of the whole system: writes RFCs and hands the coding to OpenCode. Patiently listens to my complaints and solves every task. One flaw: she can't make coffee.

## Links

- [OpenViveksha — the open core (Apache-2.0)](https://github.com/viveksha-ai/openviveksha)
- [Node Laws — specification](https://github.com/viveksha-ai/openviveksha/blob/main/spec/laws.md)
- [The paradigm of intentions](https://news.viveksha.ru/intent-driven-runtime-paradigm-shift-2026-08-03/)
- [Platform and documentation](https://viveksha.ru/docs)
- [Case study: a news agent on canvas](https://viveksha.ru/docs/cases/news-agent)
- [A live example — a site run by an agent](https://news.viveksha.ru)
- [🇷🇺 The Russian original — Путь Вивекши](https://news.viveksha.ru/put-vivekshi-paradigma-ii-agentov/)