// Rocket Demo for Web-Based Command Line UI
// Copyright (C) MMXVIII Arthur A. Gleckler.
// GNU LGPL v3.  See "LICENSE.txt" and "COPYING.LESSER".

const ORBIT_TYPES = [{name: "geosynchronous", class: "geosynchronous"},
                     {name: "high earth orbit", class: "heo"},
                     {name: "low earth orbit", class: "leo"},
                     {name: "medium earth orbit", class: "meo"}];

let parseOrbit =
    parseChoice(...ORBIT_TYPES.map(ot => parseConstant(ot.name, ot.class)));

const ORBIT_TYPE = mpt(parseOrbit, "type of orbit");

function selectorToNames(selector) {
  return Array.from(document.querySelectorAll(selector)).map(n => n.id);
}

function parseRocket(selector) {
  return parseDelayed(function() {
    return parseChoice(
      ...selectorToNames(selector).map(rt => parseConstant(rt)));
  });
}

function makeRocketType(help, selector) {
  return mpt(parseRocket(selector),
             help,
             { showCandidates: showCandidateRockets(selector),
               showChoices: showChosenRocket });
}


const ROCKET_TYPE = makeRocketType("name of a rocketship", ".rocket");

const FUELED_ROCKET_TYPE =
      makeRocketType("name of a fueled rocketship", ".fueled");

const LAUNCHED_ROCKET_TYPE =
      makeRocketType("name of a launched rocketship", ".launched");

const NOT_LAUNCHED_ROCKET_TYPE =
      makeRocketType("name of an unlaunched rocketship",
                     ".rocket:not(.launched)");

function alter(action, selector) {
  for (let n of Array.from(document.querySelectorAll(selector))) {
    action(n);
  }
}

function highlight(classToAdd, selector) {
  alter(n => n.classList.add(classToAdd), selector);
}

function unhighlight(classToRemove, selector="." + classToRemove) {
  alter(n => n.classList.remove(classToRemove), selector);
}

function showCandidateRockets(selector) {
  return function (annotations, position, param) {
    highlight("candidate", selector);
  };
}

function showChosenRocket(param, position) {
  highlight("choice", "#" + param.label.witness);
}

function unShowCandidates() {
  unhighlight("candidate");
}

function unShowChoices() {
  unhighlight("choice");
}

let ROCKET_GRAMMAR = [
  { name: "Fuel Rocket",
    positional: [["name", NOT_LAUNCHED_ROCKET_TYPE]],
    optional:   [["amount", NON_NEGATIVE_INTEGER_TYPE]]},
  { name: "Land Rocket",
    positional: [["name", LAUNCHED_ROCKET_TYPE]] },
  { name: "Launch Rocket",
    positional: [["name", FUELED_ROCKET_TYPE]],
    optional:   [["orbit", ORBIT_TYPE]] }
];

function handlePartialRocketCommand(annotations, position) {
  unShowCandidates();
  unShowChoices();
  showCandidatesAndChoices(annotations, position);
}

function emptyRocket(name) {
  unhighlight("fueled", "#" + name);
}

function fuelRocket(name) {
  highlight("fueled", "#" + name);
}

function landRocket(name) {
  unhighlight("geosynchronous", "#" + name);
  unhighlight("heo", "#" + name);
  unhighlight("launched", "#" + name);
  unhighlight("leo", "#" + name);
  unhighlight("meo", "#" + name);
}

function launchRocket(name, orbit) {
  highlight("launched", "#" + name);
  if (orbit) {
    highlight(orbit, "#" + name);
  }
  emptyRocket(name);
}

function handleCompleteRocketCommand(command) {
  unShowCandidates();
  unShowChoices();
  editArea().innerHTML = "";

  let parameters = command.parameters;

  if (command.name == "Fuel Rocket") {
    fuelRocket(parameters.name);
  } else if (command.name == "Land Rocket") {
    landRocket(parameters.name);
  } else if (command.name == "Launch Rocket") {
    launchRocket(parameters.name,
                 "orbit" in parameters
                 ? parameters.orbit
                 : "geosynchronous");
  }
}

function initializeRocket() {
  initializeCommandHandlers(
    new CommandProcessor(
      new CommandContext(),
      handleCompleteRocketCommand,
      parseCommandFromGrammar(ROCKET_GRAMMAR),
      handlePartialRocketCommand));
}