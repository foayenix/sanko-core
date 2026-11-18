/* The plant name web: languages, local names and botanical names, and the links
 * between them. Copied to /plants/web.js by scripts/build-resolver.mjs; it reads
 * /plants/web.json, which the same build writes.
 *
 * Each view is centred on one thing — a species, a name or a language — and shows
 * only what connects to it, because all ~1,000 names at once is a tangle nobody can
 * read. Clicking any node re-centres the web on it. Without JavaScript the page's
 * tables carry the same information, so the web starts hidden and only appears once
 * it has something to show.
 */
(function () {
  'use strict';

  var LANGUAGE_CAP = 40;
  var roots = document.querySelectorAll('[data-plant-web]');
  if (!roots.length || !window.fetch) return;

  var fold = function (value) {
    return String(value)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  };

  fetch('/plants/web.json')
    .then(function (response) {
      if (!response.ok) throw new Error(response.status);
      return response.json();
    })
    .then(function (data) {
      var graph = index(data);
      roots.forEach(function (root) {
        mount(root, graph);
      });
    })
    .catch(function () {
      /* The tables on the page already say everything the web would. */
    });

  function index(data) {
    var species = data.species.map(function (entry, i) {
      return { kind: 'species', i: i, slug: entry[0], label: entry[1], edges: [] };
    });
    var names = data.names.map(function (entry, i) {
      return { kind: 'name', i: i, slug: entry[0], label: entry[1], edges: [] };
    });
    var languages = {};
    Object.keys(data.languages).forEach(function (code) {
      languages[code] = { kind: 'language', code: code, slug: code, label: data.languages[code], edges: [] };
    });
    var edges = data.edges.map(function (entry) {
      var edge = {
        name: names[entry[0]],
        species: species[entry[1]],
        language: entry[2] ? languages[entry[2]] : null,
        inferred: entry[3] ? languages[entry[3]] : null,
        records: entry[4],
      };
      edge.name.edges.push(edge);
      edge.species.edges.push(edge);
      var spoken = edge.language || edge.inferred;
      if (spoken) spoken.edges.push(edge);
      return edge;
    });
    var bySlug = { species: {}, name: {}, language: languages };
    species.forEach(function (node) {
      bySlug.species[node.slug] = node;
    });
    names.forEach(function (node) {
      bySlug.name[node.slug] = node;
    });
    return { species: species, names: names, languages: languages, edges: edges, bySlug: bySlug };
  }

  // What one view shows: the focus, everything one step from it, and — for a name or a
  // species — the other species its names are also recorded for, so a contested name
  // is visible as one name pointing two ways.
  function neighbourhood(graph, focus) {
    var shown = { language: new Map(), name: new Map(), species: new Map() };
    var links = new Set();
    var hiddenNames = 0;
    var add = function (node) {
      if (node) shown[node.kind].set(node, true);
    };
    var spokenIn = function (edge) {
      return edge.language || edge.inferred;
    };

    if (focus.kind === 'language') {
      var names = [];
      focus.edges.forEach(function (edge) {
        if (names.indexOf(edge.name) === -1) names.push(edge.name);
      });
      names.sort(function (a, b) {
        return a.label.localeCompare(b.label);
      });
      hiddenNames = Math.max(0, names.length - LANGUAGE_CAP);
      var kept = new Set(names.slice(0, LANGUAGE_CAP));
      add(focus);
      focus.edges.forEach(function (edge) {
        if (!kept.has(edge.name)) return;
        add(edge.name);
        add(edge.species);
        links.add(edge);
      });
    } else {
      var direct = focus.edges;
      add(focus);
      direct.forEach(function (edge) {
        add(edge.name);
        add(edge.species);
        add(spokenIn(edge));
        links.add(edge);
      });
      if (focus.kind === 'species') {
        // Other species the same names are recorded for.
        direct.forEach(function (edge) {
          edge.name.edges.forEach(function (other) {
            if (other.species === focus) return;
            add(other.species);
            links.add(other);
          });
        });
      }
    }
    return { shown: shown, links: links, hiddenNames: hiddenNames };
  }

  function mount(root, graph) {
    var stage = root.querySelector('.web-stage');
    var summary = root.querySelector('.web-summary');
    var open = root.querySelector('.web-open');
    var search = root.querySelector('.web-search input');
    var suggestions = root.querySelector('.web-suggestions');
    var follow = root.hasAttribute('data-follow-hash');
    var initial = { kind: root.getAttribute('data-focus-kind'), slug: root.getAttribute('data-focus') };
    // The view on screen: its focus, the elements drawn for each node, the links between
    // them and the SVG paths for those links. Kept here, never on the shared graph nodes.
    var current = null;

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'web-links');
    svg.setAttribute('aria-hidden', 'true');
    var headings = document.createElement('div');
    headings.className = 'web-headings';
    ['Language', 'Local name', 'Botanical name'].forEach(function (label) {
      var heading = document.createElement('p');
      heading.className = 'web-heading';
      heading.textContent = label;
      headings.appendChild(heading);
    });
    var columns = document.createElement('div');
    columns.className = 'web-columns';
    stage.appendChild(headings);
    stage.appendChild(svg);
    stage.appendChild(columns);

    var lookup = function (kind, slug) {
      return graph.bySlug[kind] && graph.bySlug[kind][slug];
    };

    var pageFor = function (node) {
      if (node.kind === 'species') return '/plants/botanical/' + node.slug + '/';
      if (node.kind === 'name') return '/plants/' + node.slug + '/';
      return '/plants/language/' + node.code + '/';
    };

    function render(focus) {
      var view = neighbourhood(graph, focus);
      columns.textContent = '';
      var elements = new Map();
      var ordered = order(view, focus);
      [['language'], ['name'], ['species']].forEach(function (column) {
        var list = document.createElement('div');
        list.className = 'web-column web-column-' + column[0];
        ordered[column[0]].forEach(function (node) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'web-node' + (node === focus ? ' is-focus' : '');
          if (node.kind === 'species') button.classList.add('is-species');
          if (node.kind === 'species' && focus.kind === 'species' && node !== focus) button.classList.add('is-other');
          button.textContent = node.label;
          button.addEventListener('click', function () {
            go(node);
          });
          button.addEventListener('mouseenter', function () {
            highlight(node);
          });
          button.addEventListener('focus', function () {
            highlight(node);
          });
          button.addEventListener('mouseleave', function () {
            highlight(null);
          });
          button.addEventListener('blur', function () {
            highlight(null);
          });
          elements.set(node, button);
          list.appendChild(button);
        });
        if (column[0] === 'name' && view.hiddenNames) {
          var more = document.createElement('a');
          more.className = 'web-more';
          more.href = pageFor(focus);
          more.textContent = 'and ' + view.hiddenNames + ' more on the ' + focus.label + ' page';
          list.appendChild(more);
        }
        columns.appendChild(list);
      });

      current = { focus: focus, elements: elements, links: view.links, paths: [] };
      root.hidden = false;
      draw();
      describe(focus, view);
      open.href = pageFor(focus);
      open.textContent =
        focus.kind === 'language' ? 'All ' + focus.label + ' names →' : 'Open the page for ' + focus.label + ' →';
    }

    // Each column is ordered by where its connections sit in the column to its left
    // (the barycentre), which removes most crossings: a species view lists names grouped
    // by language, a language view lists species in the order of the names that reach
    // them. A language view keeps its names alphabetical, which is what "the first 40"
    // refers to.
    function order(view, focus) {
      var alphabetical = function (a, b) {
        return a.label.localeCompare(b.label);
      };
      var focusFirst = function (nodes) {
        return nodes.filter(function (node) { return node === focus; })
          .concat(nodes.filter(function (node) { return node !== focus; }));
      };
      var byCentre = function (nodes, neighbours, positions) {
        var centre = new Map();
        nodes.forEach(function (node) {
          var places = neighbours(node).map(function (other) { return positions.get(other); })
            .filter(function (place) { return place !== undefined; });
          centre.set(node, places.length ? places.reduce(function (sum, place) { return sum + place; }, 0) / places.length : Infinity);
        });
        return nodes.slice().sort(function (a, b) {
          return centre.get(a) - centre.get(b) || alphabetical(a, b);
        });
      };
      var positionsOf = function (nodes) {
        return new Map(nodes.map(function (node, i) { return [node, i]; }));
      };
      var shownEdges = Array.from(view.links);

      var languages = focusFirst(Array.from(view.shown.language.keys()).sort(alphabetical));
      var names = Array.from(view.shown.name.keys()).sort(alphabetical);
      if (focus.kind !== 'language') {
        names = byCentre(names, function (name) {
          return shownEdges.filter(function (edge) { return edge.name === name; })
            .map(function (edge) { return edge.language || edge.inferred; }).filter(Boolean);
        }, positionsOf(languages));
      }
      names = focusFirst(names);
      var species = byCentre(Array.from(view.shown.species.keys()), function (taxon) {
        return shownEdges.filter(function (edge) { return edge.species === taxon; })
          .map(function (edge) { return edge.name; });
      }, positionsOf(names));
      if (focus.kind === 'species') species = focusFirst(species);
      return { language: languages, name: names, species: species };
    }

    function describe(focus, view) {
      var count = function (kind) {
        return view.shown[kind].size - (focus.kind === kind ? 1 : 0);
      };
      var plural = function (n, one, many) {
        return n + ' ' + (n === 1 ? one : many);
      };
      var text;
      if (focus.kind === 'species') {
        var others = count('species');
        text =
          focus.label + ': ' + plural(count('name'), 'local name', 'local names') + ' in ' + plural(count('language'), 'language', 'languages') + '.' +
          (others ? ' ' + plural(others, 'other species shares', 'other species share') + ' one of these names.' : '');
      } else if (focus.kind === 'name') {
        var taxa = count('species');
        text = focus.label + ': recorded for ' + plural(taxa, 'species', 'species') + (taxa > 1 ? ' — the sources disagree' : '') + ', in ' + plural(count('language'), 'language', 'languages') + '.';
      } else {
        var total = new Set(focus.edges.map(function (edge) { return edge.name; })).size;
        text = focus.label + ': ' + plural(total, 'name', 'names') + (view.hiddenNames ? ', the first ' + LANGUAGE_CAP + ' shown' : '') + '.';
      }
      summary.textContent = text;
    }

    function point(element, side) {
      var box = element.getBoundingClientRect();
      var origin = stage.getBoundingClientRect();
      return {
        x: (side === 'left' ? box.left : box.right) - origin.left,
        y: box.top + box.height / 2 - origin.top,
      };
    }

    function curve(from, to) {
      var bend = (to.x - from.x) / 2;
      return 'M' + from.x + ',' + from.y + ' C' + (from.x + bend) + ',' + from.y + ' ' + (to.x - bend) + ',' + to.y + ' ' + to.x + ',' + to.y;
    }

    function draw() {
      if (!current) return;
      var box = stage.getBoundingClientRect();
      svg.setAttribute('width', box.width);
      svg.setAttribute('height', box.height);
      svg.setAttribute('viewBox', '0 0 ' + box.width + ' ' + box.height);
      svg.textContent = '';
      current.paths = [];
      // One line per name and language. A suggested (inferred) language always has a
      // labelled record for the same name and species behind it, so it never adds a line
      // of its own; the tables mark which records were inferred.
      var spokenDrawn = new Set();
      current.links.forEach(function (edge) {
        var name = current.elements.get(edge.name);
        var species = current.elements.get(edge.species);
        var spoken = edge.language || edge.inferred;
        var language = spoken && current.elements.get(spoken);
        var width = String(Math.min(1 + edge.records, 5));
        var make = function (from, to, className) {
          var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', curve(from, to));
          path.setAttribute('class', className);
          path.setAttribute('stroke-width', width);
          svg.appendChild(path);
          current.paths.push({ path: path, edge: edge });
        };
        var other = current.focus.kind === 'species' && edge.species !== current.focus;
        if (name && species) make(point(name, 'right'), point(species, 'left'), 'web-link' + (other ? ' is-other' : ''));
        var spokenKey = spoken && edge.name.i + '|' + spoken.code;
        if (language && name && !spokenDrawn.has(spokenKey)) {
          spokenDrawn.add(spokenKey);
          make(point(language, 'right'), point(name, 'left'), 'web-link');
        }
      });
      highlight(null);
    }

    function highlight(node) {
      if (!current) return;
      var lit = new Set();
      current.paths.forEach(function (entry) {
        var edge = entry.edge;
        var touches = !node || edge.name === node || edge.species === node || edge.language === node || edge.inferred === node;
        entry.path.classList.toggle('is-lit', Boolean(node) && touches);
        entry.path.classList.toggle('is-dim', Boolean(node) && !touches);
        if (node && touches) {
          lit.add(edge.name);
          lit.add(edge.species);
          lit.add(edge.language || edge.inferred);
        }
      });
      current.elements.forEach(function (element, key) {
        element.classList.toggle('is-dim', Boolean(node) && key !== node && !lit.has(key));
      });
    }

    function go(node, fromHash) {
      render(node);
      if (follow && !fromHash) {
        var hash = '#' + node.kind + '=' + node.slug;
        if (location.hash !== hash) history.pushState(null, '', hash);
      }
    }

    function fromHash() {
      var match = /^#(species|name|language)=(.+)$/.exec(location.hash);
      return match && lookup(match[1], decodeURIComponent(match[2]));
    }

    if (search) {
      var everything = graph.species
        .concat(graph.names)
        .concat(Object.keys(graph.languages).map(function (code) { return graph.languages[code]; }))
        .map(function (node) {
          return { node: node, key: fold(node.label) };
        });
      search.addEventListener('input', function () {
        var query = fold(search.value);
        suggestions.textContent = '';
        if (query.length < 2) return;
        everything
          .filter(function (entry) { return entry.key.indexOf(query) !== -1; })
          .sort(function (a, b) {
            return (a.key.indexOf(query) === 0 ? 0 : 1) - (b.key.indexOf(query) === 0 ? 0 : 1) || a.key.localeCompare(b.key);
          })
          .slice(0, 8)
          .forEach(function (entry) {
            var item = document.createElement('button');
            item.type = 'button';
            item.className = 'web-suggestion';
            item.textContent = entry.node.label + ' · ' + (entry.node.kind === 'species' ? 'botanical name' : entry.node.kind === 'name' ? 'local name' : 'language');
            item.addEventListener('click', function () {
              search.value = '';
              suggestions.textContent = '';
              go(entry.node);
            });
            suggestions.appendChild(item);
          });
      });
    }

    if (follow) {
      window.addEventListener('popstate', function () {
        var node = fromHash();
        if (node) render(node);
      });
    }

    var start = (follow && fromHash()) || lookup(initial.kind, initial.slug);
    if (!start) return;
    render(start);

    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        draw();
      }).observe(stage);
    } else {
      window.addEventListener('resize', draw);
    }
  }
})();
