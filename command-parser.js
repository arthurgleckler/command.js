// Web-Based Command Line Parser
// Copyright (C) MMXVIII Arthur A. Gleckler.
// GNU LGPL v3.  See "LICENSE.txt" and "COPYING.LESSER".

// General parsing

// Each parser takes an input string and a `success' object and returns two
// values: a list of `success' objects and either a single `failure' object or
// false.  The top-level parser is given a success object that records the
// starting position in the input string as zero.

// The context is an application-specific object used to influence parsing while
// keeping parsing pure in the functional programming sense.  For example, it
// can be used to allow the parser to inspect the DOM, or to include default
// values fetched from the server as possible completions for parameter values.

// Both success and failure objects record the position at which matching ended
// and a set of annotations of the input stream.

// Success objects also record a witness — an object representing the parse
// between the start position given to the parser and the end position recorded
// in the success object.  In addition, they record the context.

// The failure object is only returned if a failed parse occurs that ends after
// all of the successful ones.  It contains a list of completions possible at
// its end.  It also includes a Boolean that specifies whether the included list
// of completions is incomplete and that completion should therefore pause.

class Annotation {
  constructor(label, start, end) {
    this.end = end;
    this.label = label;
    this.start = start;
  }

  equals(annotation) {
    function labelsEqual(label1, label2) {
      let keys1 = Object.keys(label1);
      let keys2 = Object.keys(label2);

      if (keys1.length != keys2.length) {
        return false;
      }
      for (let k1 of keys1) {
        if (label1[k1] != label2[k1]) {
          return false;
        }
      }
      return true;
    }

    return (annotation.start == this.start
            && annotation.end == this.end
            && labelsEqual(annotation.label, this.label));
  }
}

class CommandContext {
  default(id, parameterName) {
    return null;
  }

  parseDefaults(commandName, parameterName, presentationType) {
    return presentationType.parse;
  }
}

class Success {
  constructor(annotations, context, end, witness) {
    this.annotations = annotations;
    this.context = context;
    this.end = end;
    this.witness = witness;
  }

  static initial(context) {
    return new Success([], context, 0, null);
  }
}

class Failure {
  constructor(annotations, completions, end, pause=completions.length == 0) {
    this.annotations = annotations;
    this.completions = completions;
    this.end = end;
    this.pause = pause;
  }

  prependAnnotations(annotations) {
    return new Failure([...annotations, ...this.annotations],
                       this.completions,
                       this.end,
                       this.pause);
  }

  replaceAnnotations(annotations) {
    return new Failure(annotations, this.completions, this.end, this.pause);
  }
}

function logAnnotations(annotations) {
  annotations.forEach(
    (a, i) => console.log("  " + i + ": " + JSON.stringify(a)));
}

// Return an equivalent to <parser> that logs its results for debugging
// purposes.
function logParser(parser) {
  function logFailure(failure) {
    console.log("failure (" + failure.end + ")");
    logAnnotations(failure.annotations);
    failure.completions.forEach(c => console.log("  " + c));
  }

  function logSuccess(success) {
    console.log("success (" + success.end + ")");
    console.log("   witness: " + JSON.stringify(success.witness));
    logAnnotations(success.annotations);
  }

  return function(input, success) {
    let [successes, failure] = parser(input, success);

    console.log("----------");
    successes.forEach(logSuccess);
    if (failure) {
      logFailure(failure);
    }

    return [successes, failure];
  };
}

function furthestSuccess(successes) {
  return Math.max(...successes.map(s => s.end));
}

function parseCheckInvariants(parser) {
  return function(input, success) {
    let [successes, failure] = parser(input, success);
    let furthest = furthestSuccess(successes);

    successes.forEach(function(s) {
      console.assert(s.witness != undefined, "Undefined witness.");
    });
    if (failure) {
      console.assert(
        furthest <= failure.end,
        "Failure's end must be no earlier than furthest success's end.");
    } else {
      console.assert(
        successes.length > 0,
        "If there is no failure, there must be at least one success.");
    }
    return [successes, failure];
  };
}

// Return a parser equivalent to <parser> but that adds an annotation with
// <label>, regardless of whether the parse succeeds or fails.  On success, add
// the witness to the label.
function annotate(label, parser) {
  function addWitness(label, witness) {
    let result = {};

    for (let key in label) {
      result[key] = label[key];
    }
    result.witness = witness;
    return result;
  }

  return function(input, success) {
    let [successes, failure] = parser(input, success);

    function extend(s) {
      return new Success([new Annotation(addWitness(label, s.witness),
                                         success.end,
                                         s.end),
                          ...s.annotations],
                         s.context,
                         s.end,
                         s.witness);
    }

    return [successes.map(extend),
            failure &&
            new Failure([new Annotation(label, success.end, failure.end),
                         ...failure.annotations],
                        failure.completions,
                        failure.end,
                        failure.pause)];
  };
}

function substringMatchForward(string1, start1, end1, string2, start2, end2) {
  let stop1 = start1 + Math.min(end1 - start1, end2 - start2);

  for (var i = start1, j = start2;
       i < stop1 && string1[i] == string2[j];
       i++, j++) {
  }
  return i - start1;
}

// Return the length of the longest common prefix.
function stringMatchForward(string1, string2) {
  return substringMatchForward(string1, 0, string1.length,
                               string2, 0, string2.length);
}

// Return a parser for string <constant>.
function parseConstant(constant, witness=constant) {
  let size = constant.length;

  return function(input, success) {
    let start = success.end;
    let comparisonSize = Math.min(size, input.length - start);
    let matchSize = substringMatchForward(
      input, start, start + comparisonSize, constant, 0, comparisonSize);

    return matchSize == size
      ? [[new Success(success.annotations,
                      success.context,
                      start + size,
                      witness)],
         null]
      : [[],
         new Failure(
           [],
           [constant.slice(matchSize)],
           start + matchSize,
           false)];
  };
}

// Given an array of strings in <completions>, return the unique shortest
// prefixes, i.e. all completions that do not have another as a prefix.
function normalizeCompletions(completions) {
  if (completions.length == 0) {
    return [];
  }

  let sorted = completions.slice().sort();
  let accumulator = sorted.slice(0, 1);
  let i = 0;

  sorted.slice(1).forEach(function(c) {
    if (! c.startsWith(accumulator[i])) {
      accumulator.push(c);
      i++;
    }
  });
  return accumulator;
}

// Return all the unique annotations from two arrays of annotations.
function mergeAnnotations(annotations1, annotations2) {
  let result = new Set(annotations1);

  annotations2.forEach(a => result.add(a));
  return Array.from(result.keys());
}

function mergeFailures(f1, f2) {
  if (! f1) { return f2; }
  if (! f2) { return f1; }

  let e1 = f1.end;
  let e2 = f2.end;

  if (e1 == e2) {
    return new Failure(
      mergeAnnotations(f1.annotations, f2.annotations),
      normalizeCompletions([...f1.completions, ...f2.completions]),
      e1,
      f1.pause || f2.pause);
  }
  return e1 < e2 ? f2 : f1;
}

function parseAlternatives(parser1, parser2) {
  return function(input, success) {
    let [s1, f1] = parser1(input, success);
    let [s2, f2] = parser2(input, success);
    let successes = [...s1, ...s2];
    let furthest = furthestSuccess(successes);

    return [successes,
            mergeFailures(f1 && f1.end >= furthest && f1,
                          f2 && f2.end >= furthest && f2)];
  };
}

function parseWithFallback(parser, fallbackParser) {
  return function(input, success) {
    let [s1, f1] = parser(input, success);
    let [s2, f2] = fallbackParser(input, success);
    let successes = [...s1, ...s2];
    let furthest = furthestSuccess(successes);

    return [successes,
            f1 && f1.end >= furthest && f1];
  };
}

function parseFail(input, success) {
  return [[], new Failure([], [], success.end, false)];
}

function parseChoice(...parsers) {
  return parsers.reduce(parseAlternatives, parseFail);
}

// Run <parser1>, then the parsers that result from calling <chain> on each
// <Success>, starting from where that <Success> left off.  Construct each
// successful parse's witness by calling <mergeWitnesses> on the underlying
// <Success>es' witnesses, in order.
function parseChain(mergeWitnesses, parser1, chain) {
  return function(input, success) {
    let [successes1, failure1] = parser1(input, success);
    let failure = failure1;
    let furthest = 0;
    let successes = [];

    for (let s1 of successes1) {
      let [s2, f2] = chain(s1)(input, s1);

      failure = mergeFailures(failure,
                              f2 && f2.prependAnnotations(s1.annotations));
      furthest = Math.max(furthest, furthestSuccess(s2));

      let annotations1 = s1.annotations;
      let witness1 = s1.witness;

      successes.push(
        s2.map(function(s) {
          return new Success(s.annotations,
                             s.context,
                             s.end,
                             mergeWitnesses(witness1, s.witness));
        }));
    }
    return [[].concat(...successes),
            failure && failure.end >= furthest && failure];
  };
}

// Run <parser1>, then <parser2> in sequence.  Construct each successful parse's
// witness by calling <mergeWitnesses> on the underlying successes' witnesses,
// in order.
function parseThen(mergeWitnesses, parser1, parser2) {
  return parseChain(mergeWitnesses, parser1, success => parser2);
}

// Match the empty string.
function parseEmpty(witness = "empty") {
  return function(input, success) {
    return [[new Success(success.annotations,
                         success.context,
                         success.end,
                         witness)],
            null];
  };
}

// Return a new result equivalent to <success> but with its witness transformed
// by <transform>.
function transformWitness(success, transform) {
  return new Success(success.annotations,
                     success.context,
                     success.end,
                     transform(success.witness));
}

// Parse using all <parsers> in sequence.  Use <mergeWitnesses> to
// merge the witnesses in the chain of each successful parse.
function parseSequence(mergeWitnesses, ...parsers) {
  function reverseParseThen(p1, p2) {
    return parseThen((w1, w2) => [w2, ...w1], p1, p2);
  }
  function merge(s) {
    return transformWitness(
      s,
      w => mergeWitnesses(...w.slice().reverse()));
  }

  let parser = parsers.reduce(reverseParseThen, parseEmpty([]));

  return function(input, success) {
    let [successes, failure] = parser(input, success);

    return [successes.map(merge), failure];
  };
}

// Run <parser> on <input> and <start>.  Run <transform> on the witnesses of all
// successful parses.
function parseTransform(parser, transform) {
  function transformSuccess(s) {
    return new Success(s.annotations, s.context, s.end, transform(s.witness));
  }

  return function(input, success) {
    let [successes, failure] = parser(input, success);

    return [successes.map(transformSuccess), failure];
  };
}

// Given a list of <elements>, return two lists.  The first should contain all
// elements for which <predicate> returns true, and the second should contain
// the rest.  Preserve order.
function categorize(array, predicate) {
  let negatives = [];
  let positives = [];

  for (let x of array) {
    (predicate(x) ? positives : negatives).push(x);
  }
  return [positives, negatives];
}

// Return a parser equivalent to <parser>, but drop any <Success>es for which
// the witness is a false value.
function parseFilter(parser) {
  return function(input, success) {
    let [successes, failure] = parser(input, success);
    let [positives, negatives] = categorize(successes, s => s.witness);

    if (positives.length == 0 && ! failure) {
      return [[], new Failure([], [], success.end, false)];
    }
    return [positives, failure];
  };
}

// Parse using <parser> repeatedly until it returns an incomplete result, then
// return the results before that.  To produce the witness, call
// <mergeWitnesses> on the array of witnesses produced by all the complete
// results.
function parseStar(mergeWitnesses, parser) {
  function parseKleene() {
    return parseAlternatives(
      parseEmpty([]),
      parseThen((w1, w2) => [w1, ...w2],
                parser,
                (input, success) => parseKleene()(input, success)));
  }

  return parseTransform(parseKleene(), mergeWitnesses);
}

// Like <parseStar>, but elements must be separated by input that
// <parseSeparator> accepts.
function parseSeparated(mergeWitnesses, parseElement, parseSeparator) {
  function parseRepeated() {
    return parseThen(
      (w1, w2) => [w1, ...w2],
      parseElement,
      parseAlternatives(
        parseEmpty([]),
        parseThen((s, w) => w,
                  parseSeparator,
                  (input, success) => parseRepeated()(input, success))));
  }
  return parseTransform(
    parseAlternatives(parseEmpty([]), parseRepeated()),
    mergeWitnesses);
}

// Read until the end of <regexp> is found.  For now, <regexp> must be a regular
// expression that matches all non-empty prefixes of its input.  That way, it
// will match as the user types each character.  Construct the witness by
// passing the input string and registers to <makeWitness>.

// <> Produce completions.  <> Eliminate the restriction mentioned above.  This
// will require detecting when the input so far is a potential match of the
// regular expression so that <end> can be moved to the end of the input as the
// user types.
function parseRestrictedRegexp(makeWitness, regexp) {
  return function(input, success) {
    let start = success.end;
    let result = regexp.exec(input.slice(start));

    if (result && result.index == 0) {
      return [[new Success(success.annotations,
                           success.context,
                           start + result[0].length,
                           makeWitness(result))],
              null];
    }
    return [[], new Failure([], [], start, true)];
  };
}

// Run <parser>, but fail if it fails or if it matches the empty string.
function parseNonEmpty(parser) {
  return function (input, success) {
    let [successes, failure] = parser(input, success);
    let start = success.end;
    let [empties, nonEmpties] = categorize(successes, s => start == s.end);

    return empties.length == 0
      ? [successes, failure]
      : [nonEmpties, failure || new Failure([], [], start, false)];
  };
}

// Like <parseStar>, but <parser> must match at least once.
function parsePlus(mergeWitnesses, parser) {
  return parseNonEmpty(parseStar(mergeWitnesses, parser));
}

// Return the parser created by thunk <makeParser>, but wait to call
// <makeParser> until the parser is invoked.
function parseDelayed(makeParser) {
  return function(input, success) {
    return makeParser()(input, success);
  };
}

// Return a parser equivalent to <parser>, but that also succeeds if there is no
// match.
function parseOptional(parser, witness="missing") {
  return parseChoice(parser, parseEmpty(witness));
}

// Parse values

let parseDoubleQuote = parseConstant("\"", "double-quote");
let parseEscapedBackslash = parseConstant("\\\\", "\\");
let parseEscapedDoubleQuote = parseConstant("\\\"", "\"");
let parseEscapeString = parseChoice(parseEscapedBackslash,
                                    parseEscapedDoubleQuote);

// Return the list of annotations of the given <Success>es, as determined by
// <mergeAnnotations>.
function mergeSuccessAnnotations(successes) {
  let annotations = successes.map(s => s.annotations);

  return annotations.reduce(mergeAnnotations, []);
}

// Return a parser equivalent to <parser>, but that returns a result with
// completions returned by <makeCompletions> when given context, <Failure>, and
// start position.  Assume that no completions pause is necessary.
function parseWithCompletions(makeCompletions, parser) {
  return function(input, success) {
    let [successes, failure] = parser(input, success);
    let completions = makeCompletions(success.context, failure, success.end);

    if (failure) {
      return [successes,
              new Failure(
                failure.annotations, completions, failure.end, false)];
    }
    if (completions.length == 0) {
      return [successes, null];
    }
    return [successes,
            new Failure(mergeSuccessAnnotations(successes),
                        completions,
                        furthestSuccess(successes),
                        false)];
  };
}

function parsePause(parser) {
  return function(input, success) {
    let [successes, failure] = parser(input, success);
    let incomplete =
          failure &&
          new Failure(failure.annotations,
                      failure.completions,
                      failure.end,
                      true);

    return [successes, incomplete];
  };
}

function withoutCompletions(parser) {
  return parseWithCompletions((context, failure, start) => [], parser);
}

let parseString =
      parseSequence(
        (q1, s, q2) => s,
        parseDoubleQuote,
        parsePause(
          withoutCompletions(
            parseStar(
              witnesses => witnesses.join(""),
              parseChoice(
                parseEscapeString,
                parseRestrictedRegexp(result => result[0], /[^\"]+/))))),
        withoutCompletions(parseDoubleQuote));

// Parse a non-empty string of whitespace.
let parseWhitespace = parseWithCompletions(
  (context, failure, start) => failure && start == failure.end ? [" "] : [],
  parseRestrictedRegexp(result => "whitespace", /\s+/));

// Parse a comma, perhaps with  whitespace on either side.
let parseComma = parseWithCompletions(
  (context, failure, start) => failure && start == failure.end ? [","] : [],
  parseRestrictedRegexp(result => "comma", /\s*,\s*/));

function parseCommaSeparated(parser) {
  return parseSeparated(w => w, parser, parseComma);
}

const DIGIT_LIST = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

let parseNonNegativeInteger =
      parseWithCompletions(
        (context, failure, start) => DIGIT_LIST,
        parseRestrictedRegexp(result => parseInt(result[0], 10), /[0-9]+/));

let parseInteger =
      parseSequence(
        function(...witnesses) {
          let sign = witnesses[0];
          let absoluteValue = witnesses[1];

          return sign * absoluteValue;
        },
        parseOptional(
          parseChoice(
            parseConstant("+", 1),
            parseConstant("-", -1)),
          1),
        parseNonNegativeInteger);

// Return an array of the numbers [0, n).
function iota(n, offset=0) {
  let accumulator = [];

  for (let i = 0; i < n; i++ ) {
    accumulator.push(i + offset);
  }
  return accumulator;
}

// <> Fix: This is wasteful for large ranges.
// Return a parser for integers in the range [start, start + count).
function parseIntegerInRange(count, start=0) {
  return parseChoice(
      ...iota(count, start).map(x => parseConstant(x.toString(), x)));
}

function prefixElements(insert, elements) {
  let accumulator = [];

  elements.forEach(function(e) {
    accumulator.push(insert);
    accumulator.push(e);
  });
  return accumulator;
}

function removePrefixes(...elements) {
  return elements.filter((e, i) => i % 2 == 1);
}

function whitespacePrefixed(parsers) {
  return parseSequence(
    removePrefixes,
    ...prefixElements(parseWhitespace, parsers));
}

function separate(insert, elements) {
  return prefixElements(insert, elements).slice(1);
}

function removeSeparators(...elements) {
  return elements.filter((e, i) => i % 2 == 0);
}

function whitespaceSeparated(parsers) {
  return parseSequence(
    removeSeparators,
    ...separate(parseWhitespace, parsers));
}

// Drop any <Success> that <parser> returns that has a null witness.  This is a
// convenient way to build parsers that might fail because a computation to
// produce the witness detects the failure.
function parseMaybe(parser) {
  return function(input, success) {
    let [successes, failure] = parser(input, success);
    let [nulls, nonNulls] = categorize(successes, s => s.witness == null);

    if (nonNulls.length > 0) {
      return [nonNulls, failure];
    }
    return [[],
            failure
            || new Failure(
              mergeSuccessAnnotations(successes), [], success.end, false)];
  };
}


// Return a parser equivalent to <parser>, but that substitutes the context in
// each <Success> result with one produced by calling <makeContext> on that
// <Success>.
function parseContext(makeContext, parser) {
  function updateContext(success) {
    return new Success(
      success.annotations, makeContext(success), success.end, success.witness);
  }

  return function(input, success) {
    let [successes, failure] = parser(input, success);

    return [successes.map(updateContext), failure];
  };
}

// Presentation types

class PresentationType {
  constructor(parse, help, showCandidates, showChoices, unparse) {
    this.help = help;
    this.parse = parse;
    this.showCandidates = showCandidates;
    this.showChoices = showChoices;
    this.unparse = unparse;
  }
}

function mpt(parse, help, { showCandidates=null, showChoices=null,
                            unparse=String } = {}) {
  return new PresentationType(parse, help, showCandidates, showChoices,
                              unparse);
}

const INTEGER_TYPE = mpt(parseInteger, "an integer");
const NON_NEGATIVE_INTEGER_TYPE
        = mpt(parseNonNegativeInteger, "a non-negative integer");

function unparseString(string) {
  return "\"" + string.split("\"").join("\\\"") + "\"";
}

const STRING_TYPE = mpt(parseString, "a string surrounded by double quotes",
                        { unparse: unparseString });

const parseYesNo = parseChoice(parseConstant("yes"), parseConstant("no"));

const YES_NO_TYPE = mpt(parseYesNo, "yes or no");

// Help

// Return a parser equivalent to <parser> except that <helpText> is included as
// an annotation.
function help(parser, helpText) {
  return annotate({ tag: "help", helpText: helpText },
                  parser);
}

// Return a parser that accepts any subset of the strings in the list
// <constants>, each separated from the next by strings that <parseSeparator>
// matches.
function parseSubset(constants, parseSeparator) {
  function choose(choices) {
    return parseChain(
      (c1, c2) => [c1, ...c2],
      parseChoice(...Array.from(choices).map(c => parseConstant(c))),
      function(success) {
        let fewer = new Set(choices);

        fewer.delete(success.witness);
        if (fewer.size == 0) {
          return parseEmpty([]);
        }
        return parseAlternatives(
          parseEmpty([]),
          parseThen((s, f) => f, parseSeparator, choose(fewer)));
      });
  }
  if (constants.size == 0) {
      return parseEmpty([]);
  }
  return parseAlternatives(parseEmpty([]), choose(new Set(constants)));
}

// Parsing commands

class ParameterSpec {
  constructor(name, type=STRING_TYPE, help=null) {
    this.help = help;
    this.name = name;
    this.type = type;
  }
}

function mps(name, type=STRING_TYPE, help=null) {
  return new ParameterSpec(name, type, help);
}

function addParameterHelp(parameterSpec, parser) {
  let helpText = parameterSpec.help || parameterSpec.type.help;

  return helpText ? help(parser, helpText) : parser;
}

function parseDefaults(commandName, parameterName, presentationType) {
  return function(input, success) {
    let parser = success.context.parseDefaults(
      commandName, parameterName, presentationType);

    return parser(input, success);
  };
}

function parseParameterValue(commandName, parameterSpec) {
  let name = parameterSpec.name;
  let type = parameterSpec.type;

  return addParameterHelp(
    parameterSpec,
    annotate(
      { tag: "parameter-value",
        commandName: commandName,
        name: name,
        type: type },
      parseDefaults(commandName, name, type)));
}

// Parse whitespace followed by one keyword and value from <parameterSpecs>,
// giving preference in completions to <preferredNames>.
function parseKeywordAndValue(commandName, preferredNames, parameterSpecs) {
  function makeCompletions(context, nameFailure, start) {
    if (! nameFailure) {
      return [];
    } else if (nameFailure.end > start || preferredNames.length == 0) {
      return nameFailure.completions;
    }
    return preferredNames;
  }

  return parseChoice(
      ...parameterSpecs.map(
        function(ps) {
          let name = ps.name;
          let type = ps.type;

          return parseSequence(
            (ws1, n, ws2, v) => [n, v],
            parseWhitespace,
            parseWithCompletions(
              makeCompletions,
              annotate({ tag: "parameter-name",
                         commandName: commandName,
                         name: name },
                       parseConstant(name))),
            parseWhitespace,
            parseParameterValue(commandName, ps));
        }));
}

// Parse the keyword parameters to command named <commandName>.  Each element of
// <optional>, <preferred>, and <required> is a <parameterSpec>.  Optional
// parameters are listed in <optional>.  Preferred parameters are listed in
// <preferred>.  They are required, but are special because only they should be
// shown when they haven't yet been specified and an empty parameter completion
// appears.  Other required parameters are listed in <required>.  Annotate each
// parameter name and value.
function parseKeywordParameters(commandName, optional, preferred, required) {
  let preferredNames = preferred.map(ps => ps.name);
  let parameterSpecs = [...optional, ...preferred, ...required];
  let requiredNames = [...preferredNames, ...required.map(ps => ps.name)];

  // This copies a lot, but <Map> and <Set> don't have non-mutating delete
  // operations, so copying is hard to avoid in functional code.  It should
  // still be plenty fast.
  function next(parameterSpecs, preferredNames, requiredNames) {
    let parser = parseChain(
      (w1, w2) => [w1, ...w2],
      parseKeywordAndValue(commandName, preferredNames, parameterSpecs),
      function(success) {
        let [name, value] = success.witness;

        return next(parameterSpecs.filter(ps => ps.name != name),
                    preferredNames.filter(n => n != name),
                    requiredNames.filter(n => n != name));
      });

    return requiredNames.length == 0
      ? parseOptional(parser, [])
      : parser;
  }

  return next(parameterSpecs, preferredNames, requiredNames);
}

// Parse the positional parameters to a command, each prefixed with whitespace.
// All are required.  Each element of <positional> is a <parameter-spec>.
// Annotate each parameter value.
function parsePositionalParameters(commandName, positional) {
  return parseTransform(
    whitespacePrefixed(
      positional.map(function(ps) {
        let name = ps.name;
        let type = ps.type;

        return parseParameterValue(commandName, ps);
      })),
    witnesses => witnesses.map((w, i) => [positional[i].name, w]));
}

function commandToObject(name, parameters) {
  let encoded = Object.create(null);

  for (let [key, value] of parameters) {
    encoded[key] = value;
  }
  return { name: name, parameters: encoded };
}

// Parse command name and the parameters to the command, separated by
// whitespace, starting with the positional parameters, which are required, and
// followed by the keyword parameters.  Each element of <positional>,
// <optional>, <preferred>, and <required> is a <parameterSpec>.  See
// <parseKeywordParameters> for more details.  Annotate the command name and
// every parameter name and value.
function parseCommand(name, positional, optional, preferred, required) {
  return parseSequence(
    (n, p, k) => commandToObject(n, [...p, ...k]),
    annotate({ tag: "command-name" , name: name }, parseConstant(name)),
    parsePositionalParameters(name, positional),
    parseKeywordParameters(name, optional, preferred, required));
}

function parseCommandFromGrammar(grammar) {
  function normalize(parameters) {
    return parameters === undefined
      ? []
      : parameters.map(p => Array.isArray(p) ? mps(p[0], p[1]) : mps(p));
  }

  return parseChoice(
      ...grammar.map(function(c) {
        return parseCommand(c.name,
                            normalize(c.positional),
                            normalize(c.optional),
                            normalize(c.preferred),
                            normalize(c.required));
      }));
}

// Return the entry for <commandName> in <grammar>.
function findCommand(commandName, grammar) {
  return grammar.find(c => c.name === commandName);
}

// Return true iff <position> is in a parameter value.
function isCurrentParameterValue(position) {
  return function(annotation) {
    let label = annotation.label;

    return position >= annotation.start
      && position <= annotation.end
      && label.tag === "parameter-value";
  };
}

function showCandidates(annotations, position) {
  let param = annotations.find(isCurrentParameterValue(position));

  if (param) {
    let sc = param.label.type.showCandidates;

    if (sc) {
      sc(annotations, position, param);
    }
  }
}

function isParameterValueWithWitness(annotation) {
  return annotation.label.tag === "parameter-value"
    && annotation.label.witness;
}

function showChoices(annotations, position) {
  for (let param of annotations.filter(isParameterValueWithWitness)) {
    let ss = param.label.type.showChoices;

    if (ss) {
      ss(param, position);
    }
  }
}

function showCandidatesAndChoices(annotations, position) {
  showCandidates(annotations, position);
  showChoices(annotations, position);
}