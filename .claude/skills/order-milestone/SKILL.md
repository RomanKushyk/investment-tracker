---
name: order-milestone
description: 'Use at the end of triage-issue, after plan-epic creates sub-issues, after a version is cut, before work-issue picks an issue the owner did not name, or when asked to refresh, rebuild or re-sort the pick order or the order of cards on the project board. Not for picking or working an issue (that is work-issue).'
model: opus
---

# Order the active milestone

The project board carries the pick order of the lowest open version milestone: in every column its cards sit on top, in the order they are picked. Nothing else records that order, and this skill changes no file. Shell state does not survive between tool calls: save the block to a scratch file and `source` it in each one.

```bash
export GH_CONFIG_DIR="$HOME/.quirenote/gh-config"; P=2; O=RomanKushyk; R=investment-tracker
PID=$(gh project view $P --owner $O --format json --jq .id)
# The lowest open version milestone's title.
MT=$(gh api "repos/$O/$R/milestones?state=open&per_page=100" --jq '[.[].title|select(test("^v[0-9]+[.][0-9]+[.][0-9]+$"))]|sort_by(.[1:]|split(".")|map(tonumber))|.[0]')
# One line per open issue of $MT that has a card, in the board's current order: number, Status, labels, epic, open blockers, open sub-issues, title.
facts() { gh api graphql --paginate -f o=$O -F p=$P -f query='query($o:String!,$p:Int!,$endCursor:String){user(login:$o){projectV2(number:$p){items(first:100,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{status:fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}} content{... on Issue{number state title milestone{title} parent{number} labels(first:20){nodes{name}} blockedBy(first:50){nodes{number state}} subIssues(first:100){nodes{number state}}}}}}}}}' \
  --jq '.data.user.projectV2.items.nodes[]|.status.name as $s|.content|select(.state=="OPEN" and .milestone.title=="'"$MT"'")|"#\(.number) \($s) [\([.labels.nodes[].name]|join(" "))] epic:\(.parent.number//"-") after:\([.blockedBy.nodes[]|select(.state=="OPEN")|"#\(.number)"]|join(",")) subs:\([.subIssues.nodes[]|select(.state=="OPEN")|"#\(.number)"]|join(",")) | \(.title)"'; }
# Every issue card in board order, as "<number> <item id> <1 when it is an open issue of $MT, else 0>".
cards() { gh api graphql --paginate -f o=$O -F p=$P -f query='query($o:String!,$p:Int!,$endCursor:String){user(login:$o){projectV2(number:$p){items(first:100,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{id content{... on Issue{number state milestone{title}}}}}}}}' \
  --jq '.data.user.projectV2.items.nodes[]|select(.content.number)|"\(.content.number) \(.id) \(if .content.state=="OPEN" and .content.milestone.title=="'"$MT"'" then 1 else 0 end)"'; }
# Issue numbers in pick order: the first lands on top of the board, each next one under it. Refuses,
# before moving anything, a list that is not exactly the milestone's open issues; reads the result back.
order_board() { local -A ID; local n id in prev= all=() want=()
  while read -r n id in; do ID[$n]=$id; all+=($n); [ "$in" = 1 ] && want+=($n); done < <(cards)
  [ $# -gt 0 ] && [ "$(printf '%s\n' "$@" | sort -n | xargs)" = "$(printf '%s\n' "${want[@]}" | sort -n | xargs)" ] || { echo "refused: not exactly the open issues of $MT on the board"; return 1; }
  [ "${all[*]:0:$#}" = "$*" ] && { echo "board matches, nothing moved: $*"; return; }
  for n in "$@"; do id=${ID[$n]}
    gh api graphql -f query='mutation($p:ID!,$i:ID!,$a:ID){updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i,afterId:$a}){clientMutationId}}' -f p="$PID" -f i="$id" ${prev:+-f a="$prev"} >/dev/null || return
    prev=$id; done
  [ "$(cards | cut -d' ' -f1 | xargs | cut -d' ' -f1-$#)" = "$*" ] && echo "board matches: $*" || { echo "board differs from: $*"; return 1; }; }
```

1. **Read.** `facts`. Its lines are the whole list — every open issue of the milestone that has a card, nothing else — in the order the board holds them now.
2. **Order.** Start from that order: the owner knows it, and may have dragged a card, so an issue moves only when a rule moves it, and then the shortest way that satisfies the rule:
   - the `bug`s with no open blocker sit above every other issue;
   - an issue sits below each of its blockers that is in the list, a blocked `bug` right below the lowest of them — several such bugs by number;
   - an `epic` sits below its open sub-issues that are in the list;
   - a newly triaged or created issue arrives at the end of the list: when no rule above places it, it goes below the lowest sub-issue of its epic, or above the epics that end the list when it has none.
3. **Order the board**: `order_board N1 N2 …`, every number of the list in the new order. Neither view is sorted, so each column shows that order, above the other milestones' cards. It must end with `board matches`.
