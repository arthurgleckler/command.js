let DefaultsMixin = Base => class extends Base {
  constructor(grammar, makeURL) {
    super();
    this.grammar = grammar;
    this.defaultsCache = {};
    this.DEFAULTS_VALUE_CACHE_TIMEOUT_MILLISECONDS = 1000 * 60 * 5;
    this.makeURL = makeURL;
  }

  default(id, parameterName) {
    let info = this.isIdCached(id) && this.defaultsCache[id].value;

    return info && info[parameterName];
  }

  isKeyParameterValue(keyParameter) {
    return function(annotation) {
      return annotation.label.tag === "parameter-value"
        && annotation.label.name === keyParameter;
    };
  }

  keyParameter(commandName) {
    let commandGrammarEntry = findCommand(commandName, this.grammar);

    return commandGrammarEntry && commandGrammarEntry.keyParameter;
  }

  parseDefaults(commandName, parameterName, presentationType) {
    let context = this;

    return function(input, success) {
      let keyParameter = context.keyParameter(commandName);

      if (keyParameter) {
        let keyValue = success.annotations.find(
          context.isKeyParameterValue(keyParameter));

        if (keyValue) {
          let defaults = [];

          for (let id of context.keyValueToIDs(keyValue.label.witness)) {
            let defaultValue = context.default(id, parameterName);

            if (defaultValue) {
              defaults.push(defaultValue);
            }
          }

          let parser = parseChoice(
            presentationType.parse,
            ...defaults.map(d => parseConstant(presentationType.unparse(d), d)));

          return parser(input, success);

        }
      }
      return presentationType.parse(input, success);
    };
  }

  isIdCached(id) {
    if (id in this.defaultsCache) {
      let entry = this.defaultsCache[id];

      return "received" in entry
        && (new Date().getTime() - entry.received
            < this.DEFAULTS_VALUE_CACHE_TIMEOUT_MILLISECONDS);
    }
    return false;
  }

  isIdPending(id) {
    return (id in this.defaultsCache
            && "pending" in this.defaultsCache[id]);
  }

  markIdPending(id) {
    this.defaultsCache[id] = { pending: new Date().getTime() };
  }

  rememberId(id, value) {
    this.defaultsCache[id] = { received: new Date().getTime(), value: value };
  }

  // Convert <keyValue> witness into a list of IDs.  Normally, the witness is
  // just one ID, but this method exists to support multiple IDs and therefore
  // multiple defaults.
  keyValueToIDs(witness) {
    return witness ? [witness] : [];
  }

  onReceivingValuesForEdit(request) {
    let context = this;

    return function() {
      if (request.readyState != 4) {
        return;
      }

      if (request.status < 400) {
        let defaults = JSON.parse(request.responseText);

        for (let id of Object.keys(defaults)) {
          context.rememberId(id, defaults[id]);
        }
      } else {
        console.log("Failed to retrieve existing values for edit operation.");
      }
    };
  }

  maybeFetchDefaultValues(annotations, end) {
    let commandAnnotation = annotations.find(
      a => a.label.tag == "command-name");

    if (commandAnnotation) {
      let keyParameter = this.keyParameter(commandAnnotation.label.name);

      if (keyParameter) {
        let keyValue = annotations.find(
          this.isKeyParameterValue(keyParameter, end));

        if (keyValue && (end < keyValue.start || end > keyValue.end)) {
          let toFetch = this.keyValueToIDs(keyValue.label.witness).filter(
            id => id && !this.isIdPending(id) && !this.isIdCached(id));

          if (toFetch.length > 0) {
            let request = new XMLHttpRequest();

            request.open("GET", this.makeURL(toFetch.join(",")));
            request.onreadystatechange =
              this.onReceivingValuesForEdit(request);
            request.setRequestHeader("Content-type", "application/json");
            request.send(null);
            for (let id of toFetch) {
              this.markIdPending(id);
            }
          }
        }
      }
    }
  }
};