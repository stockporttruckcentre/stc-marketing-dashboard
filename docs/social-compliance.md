# The social planner, and what holds each part of it

From the business, on the day the planner went into use:

> make it so images uploaded to social posts actually save and the whole
> thing is wired end to end, using it from today for social post
> approvals. Ensure when I hit send for approval, business development
> manager gets a notification

and, after a piece of hallucinated code was spotted:

> fort-knox level audits end to end on everything you add, otherwise i
> get fake code.

So nothing below is a claim. Each line names the check that holds it and
the command that runs it.

## What was asked, and what holds it

| Asked for | Held by |
|---|---|
| A picture put on a post is saved | `check:social-composer`, which reads the request the composer actually sends |
| The picture survives to the row | `check:social-approval`, which reads it back off the post in PostgreSQL |
| Sending for approval tells the Business Development Manager | `check:social-approval` |
| It tells nobody else, and not the submitter | `check:social-approval` |
| The notification names who submitted it and links to the post | `check:social-approval` |
| The content library accepts a picture at all | `check:social-approval`, through `file_register` and `social_library` |
| Registering the same picture twice does not duplicate it | `check:social-approval` |
| Every control on all nine tabs does something | `check:social-sweep`, 73 elements pressed |
| No control is drawn and left unwired | `check:dead-controls`, six social components governed |
| The command bar can reach the library | `check:coverage` |

## The three checks

```bash
npm run check:social-composer   # a browser puts a picture on a post, and the saved request is read back
npm run check:social-approval   # real PostgreSQL: who is told, who is not, and what the row holds
npm run check:social-sweep      # every element on every tab, pressed, with no list of what to press
```

All three are in `npm run check:all`.

## What each check is blind to

Worth writing down, because a check nobody has thought about the limits
of is a check that gets trusted too far.

**`check:social-composer`** watches the request and stops there. It does
not prove the route wrote the column. `check:social-approval` does that,
against real PostgreSQL, from the other end.

**`check:social-approval`** runs against a database built from
`schema.sql` and `order.txt`. It proves the rules, not the production
data. A live database that has not had migration 116 pasted into it will
behave differently, and the read back file handed over in chat is how
that is confirmed.

**`check:social-sweep`** drives the real component against a stubbed
backend. It proves a control does something. It does not prove the thing
it does is the right thing: that is what the other two are for. It is
also blind to anything that is not on the screen, so a fixture that
never puts a post into a given state means the controls for that state
are never pressed. That happened once already: a post written by the
person driving hides Approve and Send back, correctly, so the fixture now
has one written by somebody else.

## Faults these checks found in themselves

**The sweep swept the wrong drawer.** Pressing the eye beside a post
opens a preview with one control in it. Pressing the card opens the post,
with Approve, Send back, Schedule and the channel table. The first
version opened the preview, found its one control wired, and reported a
pass on a drawer it had never opened.

**The sweep stopped at the first control that closed the screen.** Half
the controls in a drawer close it. Once one was pressed, every element
after it was disconnected and skipped, and the sweep reported the single
element it had managed to press as a pass: nineteen controls in the
composer came out as "1 element". A screen that can close now says how to
reopen it.

**The sweep pressed a backdrop and called a button dead.** With a drawer
open, the New post button behind it still has a size and a position, but
nothing reaches it. The sweep is scoped to what is reachable.

**`check:dead-controls` could not read this codebase's own attributes.**
Its comment stripper was two regular expressions, and `accept="image/*"`
opened a block comment that swallowed the hidden file input on the next
line. Three working upload buttons were reported dead. It walks the
source now, and the rules are run against fifteen fixtures every time so
that loosening a rule cannot quietly stop it catching anything.

## Two faults in the product that these found

**The picture was dropped twice.** The composer never sent `image_url`
and the create route never wrote it. Either fault alone loses the
picture, and both were present, which is why editing an existing post
and saving looked like it ought to have worked.

**Every post card was rendered differently on the server and in the
browser.** `toLocaleDateString('en-GB', { weekday: 'short', ... })` gives
`Tue 15 Sept` on Node and `Tue, 15 Sept` in Chromium, so React reported a
hydration mismatch and threw away the server's markup for that subtree.
Both spellings are correct English and nothing on screen looked wrong,
which is why looking would never have found it. `whenLabel` and
`dayLabel` now read the parts as numbers and supply the words
themselves.
