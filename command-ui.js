// Copyright MMII-MMXVIII Arthur A. Gleckler.  All rights reserved.

// Web-Based Command Line UI

function commandArea() {
  return document.getElementById("command");
}

function completionsArea() {
  return commandArea().getElementsByTagName("ul")[0];
}

function editArea() {
  return commandArea();
}

function commandTextDivided() {
  let accumulator = [];
  let before = true;
  let selection = window.getSelection();
  let focus = selection.focusNode;

  function descend(node) {
    switch (node.nodeType) {
    case Node.ELEMENT_NODE:
      if (node.tagName == "UL") {
        return 0;
      } else {
        let sizes = Array.from(node.childNodes).map(descend);

        return sizes.reduce((a, x) => a + x, 0);
      }
    case Node.TEXT_NODE:
      let text = node.textContent;

      accumulator.push(text);
      if (node == focus) {
        before = false;
        return selection.getRangeAt(0).endOffset;
      }
      return before ? text.length : 0;
    default:
      throw "Unexpected node type.";
    }
  }

  let offset = descend(editArea(), 0);
  let text = accumulator.join("");

  return [normalizeWhitespace(text.slice(0, offset)),
          normalizeWhitespace(text.slice(offset))];
}

function commandText() {
  let [before, after] = commandTextDivided();

  return before + after;
}

function moveCaretToEnd(editArea) {
  let selection = window.getSelection();

  selection.selectAllChildren(editArea);
  selection.collapseToEnd();
}

function removeCompletions() {
  let ca = completionsArea();

  if (ca) {
    ca.parentNode.removeChild(ca);
  }
}

function chooseCompletion(choice) {
  return function() {
    let ea = editArea();

    removeCompletions();
    ea.innerHTML += choice;
    ea.focus();
    moveCaretToEnd(ea);
  };
}

function translateString(string, regexp, replacement) {
  let accumulator = [];
  let size = string.length;

  for (let i = 0; i < size; i++) {
    let character = string[i];

    accumulator.push(regexp.test(character) ? replacement : character);
  }
  return accumulator.join("");
}

function normalizeWhitespace(string) {
  return translateString(string, /\s/g, " ");
}

// Given a <Failure> not marked for pause, return the longest
// prefix that they share.  If it is marked for pause, return the empty string.
function uniqueCompletion(failure) {
  if (failure.pause) {
    return "";
  }

  let completions = failure.completions;

  if (completions.length == 0) {
    return "";
  }

  let sorted = completions.slice().sort();
  let first = sorted[0];

  for (let s of sorted) {
    let prefix = stringMatchForward(first, s);

    if (prefix == 0) {
      return "";
    }
    first = first.slice(0, prefix);
  }
  return first;
}

// Valid parses are <Success>es that end where the input ended.
function validParses(end, successes) {
  return successes.filter(s => s.end == end);
}

function partialAnnotations(successes, failure) {
  return failure ? failure.annotations : mergeSuccessAnnotations(successes);
}

// Unless it's the only completion, don't include a completion that is just a
// space.  This is a heuristic used to make completion more helpful.
function filterCompletions(parser) {
  return function(input, success) {
    let [successes, failure] = parser(input, success);

    if (failure) {
      let completions =
          failure.completions.length == 1
          ? failure.completions
          : failure.completions.filter(c => c != " ");

      return [successes,
              new Failure(failure.annotations,
                          completions,
                          failure.end,
                          failure.pause)];
    }
    return [successes, failure];
  };
}

// Find the longest possible completion of the input, stopping as soon as there
// is no unique completion or a complete input is reached that is longer than
// the original input.  If more than one completion is possible, display them.
function complete(processor) {
  let parse = processor.parse;
  let [before, after] = commandTextDivided();
  let [successes, failure] = parse(before, Success.initial(processor.context));

  if (! failure || failure.end < before.length) {
    return;
  }

  let unique = uniqueCompletion(failure);

  if (unique == "") {
    if (failure.completions.length > 0) {
      showCommand(processor, before, after, true);
    }
    return;
  }

  let extension = "";
  let size = 0;

  do {
    extension = extension + unique;
    [successes, failure] = parse(before + extension,
                                 Success.initial(processor.context));
    size = before.length + extension.length;
    unique = failure && failure.end == size
      ? uniqueCompletion(failure)
      : "";
  } while (successes.every(s => s.end < size)
           && unique != "")

  let common = stringMatchForward(after, extension);
  let newBefore = before + extension;
  let newAfter = after.substring(common);
  let annotations = partialAnnotations(successes, failure);

  showCommand(processor, newBefore, newAfter, false);
  processor.partial(annotations, before.length + extension.length);
}

// If <character> is upper case, return the lower case equivalent.  If it is
// lower case, return the upper case equivalent.  If it is neither, return it
// unchanged.
function toOtherCase(character) {
  let lc = character.toLowerCase();
  let uc = character.toUpperCase();

  return character == lc ? uc : lc;
}

function groupBy(elements, key) {
  let accumulator = {};

  for (let e of elements) {
    let k = key(e);

    if (k in accumulator) {
      accumulator[k].push(e);
    } else {
      accumulator[k] = [e];
    }
  }
  return accumulator;
}

function numberComparator(key) {
  return function(x1, x2) {
    let k1 = key(x1);
    let k2 = key(x2);

    return k1 < k2 ? -1 : k1 == k2 ? 0 : 1;
  };
}

function showCommand(processor, before, after, showCompletions) {
  function makeSpan(tag, chunk) {
    let span = document.createElement("span");

    if (tag) {
      span.classList.add(tag);
    }
    span.textContent = chunk;
    return span;
  }

  function makeCompletionSpan(tag, chunk, prefix, completions) {
    let count = completions.length;
    let span = makeSpan(tag, chunk);
    let ul = document.createElement("ul");

    ul.contentEditable = false;
    ul.classList.add("completions");
    span.insertBefore(ul, null);
    for (let c of completions) {
      let li = document.createElement("li");
      let content = prefix.concat(c);

      li.textContent = content;
      li.addEventListener("click", chooseCompletion(c));
      ul.insertBefore(li, null);
    }
    return span;
  }

  function segments(annotations, size) {
    let groups = groupBy(annotations, a => a.start);
    let representatives = [];

    for (let i in groups) {
      representatives.push(groups[i][0]);
    }
    representatives.sort(numberComparator(a => a.start));

    let accumulator = [];
    let i = 0;

    for (let a of representatives) {
      if (i > a.start) {
        break;
      }
      if (i < a.start) {
        accumulator.push({ tag: null, start: i, end: a.start });
      }
      accumulator.push({ tag: a.label.tag, start: a.start, end: a.end });
      i = a.end;
    }
    accumulator.push({ tag: null, start: i, end: size });
    return accumulator;
  }

  let [successes, failure] =
      processor.parse(before, Success.initial(processor.context));
  let completions = failure ? failure.completions : [];
  let count = completions.length;
  let text = before + after;
  let position = before.length;
  let tags = new Set(["command-name", "parameter-name", "parameter-value"]);
  let annotations = partialAnnotations(successes, failure);
  let filtered = annotations.filter(a => tags.has(a.label.tag));
  let ea = editArea();

  ea.innerHTML = "";
  processor.partial(annotations, text.length);

  let segs = segments(filtered, text.length);
  let popup = segs.find(s => s.tag && s.start <= position && position <= s.end);

  for (s of segs) {
    let chunk = text.slice(s.start, s.end);
    let span =
        (showCompletions && count > 0 && s == popup)
        ? makeCompletionSpan(s.tag,
                             chunk,
                             text.slice(s.start, failure.end),
                             failure.completions)
        : makeSpan(s.tag, chunk);

    ea.insertBefore(span, null);
    if (s.start < position && position <= s.end) {
      let range = document.createRange();
      let selection = window.getSelection();
      let element = span.firstChild;

      range.setStart(element, position - s.start);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
}

function parseCommandText(processor, text) {
  return processor.parse(text, Success.initial(processor.context));
}

function insertCharacter(event, processor) {
  let [before, after] = commandTextDivided();

  function check(proposed) {
    let fullText = before + proposed;
    let fullLength = fullText.length;
    let [successes, failure] = parseCommandText(processor, fullText);

    if (furthestSuccess(successes) < fullLength
        && (! failure || failure.end < fullLength)) {
      return [false, false];
    }
    showCommand(processor, before + proposed, after, false);

    let valid = validParses(fullLength, successes);

    return [true, valid.length > 0];
  }

  event.preventDefault();
  event.stopPropagation();

  let [progress, valid] = check(event.key);

  if (progress) {
    return valid;
  }
  [progress, valid] = check(toOtherCase(event.key));
  return valid;
}

// Return true iff <alt>, <ctrl>, or <meta> was pressed during <keyboardEvent>.
// Note that <shift> is not considered.
function anyModifiers(keyboardEvent) {
  return keyboardEvent.altKey || keyboardEvent.ctrlKey || keyboardEvent.metaKey;
}

function completionItems() {
  return completionsArea().getElementsByTagName("li");
}

function selectedCompletionItem() {
  let choice = completionsArea().getElementsByClassName("selected-completion");

  return choice ? choice[0] : null;
}

function selectCompletion(item, processor) {
  let ca = completionsArea();
  let candidate = ca.previousSibling;

  if (candidate) {
    ca.parentNode.replaceChild(new Text(item.textContent), candidate);
  } else {
    ca.parentNode.insertBefore(new Text(item.textContent), ca);
  }
  item.classList.add("selected-completion");
  moveCaretToEnd(editArea());
}

function moveCompletionSelection(findSibling, offset) {
  return function(processor) {
    let items = completionItems();
    let size = items.length;

    if (size == 0) {
      return;
    }

    let i = selectedCompletionItem();

    if (i == null) {
      selectCompletion(completionItems()[size - 1], processor);
    } else {
      let sibling = findSibling(i);

      if (sibling) {
        i.classList.remove("selected-completion");
        selectCompletion(sibling, processor);
      }
    }
  };
}

let selectNextCompletion = moveCompletionSelection(
  n => n.nextSibling, 0);

let selectPreviousCompletion = moveCompletionSelection(
  n => n.previousSibling, -1);

function makeKeyDownHandler(processor) {
  return function(event) {
    if (event.key == " " && event.metaKey) { // M-SPC
      insertCharacter(event, processor);
    } else if (event.key == "Tab" ||
               (event.key == "i" && event.ctrlKey)) { // C-i
      complete(processor);
      event.preventDefault();
      event.stopPropagation();
    } else if (! anyModifiers(event)) {
      if (event.key == "ArrowDown") {
        selectNextCompletion(processor);
        event.preventDefault();
        event.stopPropagation();
      } else if (event.key == "ArrowUp") {
        selectPreviousCompletion(processor);
        event.preventDefault();
        event.stopPropagation();
      }
    }
  };
}

function makeDocumentKeysHandler(processor) {
  return function(event) {
    if (event.key == "x" && (event.altKey || event.metaKey)) { // M-x
      let ea = editArea();

      ea.focus();
      moveCaretToEnd(ea);
      event.preventDefault();
      event.stopPropagation();
    } else if (event.key == "Escape") { // ESC
      removeCompletions();
      editArea().blur();
    }
  };
}

function makeKeyPressHandler(processor) {
  return function(event) {
    removeCompletions();

    switch (event.key) {
    case "Enter":
      let text = commandText();
      let [successes, failure] = parseCommandText(processor, text);
      let valid = validParses(text.length, successes);

      if (valid.length > 0) {
        processor.finish(valid[0].witness);
      }
      event.preventDefault();
      event.stopPropagation();
      break;
    case " ":
      if (! insertCharacter(event, processor)) {
        complete(processor);
      }
      break;
    default:
      if (! anyModifiers(event)) {
        insertCharacter(event, processor);
      }
    }
  };
}

function assert(expression) {
  if (! expression) {
    throw new Error();
  }
}

function sendCommand(command, failure, success, url) {
  function onResponse() {
    if (request.readyState != 4) {
      return;
    }

    if (request.status < 400) {
      success(request);
    } else {
      failure(request,
              function() { sendCommand(command, failure, success, url); });
    }
  }

  let request = new XMLHttpRequest();

  request.open("POST", url);
  request.onreadystatechange = onResponse;
  request.setRequestHeader("Content-type", "application/json");
  request.send(JSON.stringify(command));
}

function defaultSuccessHandler(request) {
  if (request.status == 200) {
    let url = request.responseText;

    if (url) {
      window.location = url;
      return;
    }
  } else if (request.status == 204) {
    window.location.reload();
    return;
  }
  alert("Server response code: " + request.status);
}

function defaultFailureHandler(request, retry) {
  alert(`Error: ${request.responseText} (${request.status})`);
  return retry;
}

class CommandProcessor {
  constructor(context, finish, parse, partial) {
    this.context = context;
    this.finish = finish;
    this.parse = filterCompletions(parse);
    this.partial = partial;
  }
}

function initializeCommandHandlers(processor) {
  let ea = editArea();
  let handleDocumentKeys = makeDocumentKeysHandler(processor);
  let handleKeyDown = makeKeyDownHandler(processor);
  let handleKeyPress = makeKeyPressHandler(processor);

  document.addEventListener("keydown", handleDocumentKeys, false);
  ea.addEventListener("keydown", handleKeyDown, false);
  ea.addEventListener("keypress", handleKeyPress, false);
}