(function() {

    if (! jasmine) {
        throw new Exception("jasmine library does not exist in global namespace!");
    }

    function elapsed(startTime, endTime) {
        return (endTime - startTime)/1000;
    }

    function ISODateString(d) {
        function pad(n) { return n < 10 ? '0'+n : n; }

        return d.getFullYear() + '-' +
            pad(d.getMonth()+1) + '-' +
            pad(d.getDate()) + 'T' +
            pad(d.getHours()) + ':' +
            pad(d.getMinutes()) + ':' +
            pad(d.getSeconds());
    }

    function trim(str) {
        return str.replace(/^\s+/, "" ).replace(/\s+$/, "" );
    }

    function escapeInvalidXmlChars(str) {
        return str.replace(/\&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/\>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/\'/g, "&apos;");
    }

    /**
     * Generates JUnit XML for the given spec run.
     * Allows the test results to be used in java based CI
     * systems like CruiseControl and Hudson.
     *
     * @param {string} savePath where to save the files
     * @param {boolean} consolidate whether to save nested describes within the
     *                  same file as their parent; default: true
     * @param {boolean} useDotNotation whether to separate suite names with
     *                  dots rather than spaces (ie "Class.init" not
     *                  "Class init"); default: true
     */    
    var JUnitXmlReporter = function(savePath, consolidate, useDotNotation) {    	
        this.savePath = savePath || '';
        this.consolidate = consolidate === jasmine.undefined ? true : consolidate;
        this.useDotNotation = useDotNotation === jasmine.undefined ? true : useDotNotation;
    };
    JUnitXmlReporter.finished_at = null; // will be updated after all files have been written

    JUnitXmlReporter.prototype = {
        reportSpecStarting: function(spec) {
            spec.startTime = new Date();

            if (!spec.suite.startTime) {
                spec.suite.startTime = spec.startTime;
            }
        },

        reportSpecResults: function(spec) {
            var results = spec.results();
            spec.didFail = !results.passed();
            spec.duration = elapsed(spec.startTime, new Date());
            spec.output = '<testcase classname="" name="' + escapeInvalidXmlChars(spec.description) + '" time="' + spec.duration + '">';

            var failure = "";
            var failures = 0;
            var resultItems = results.getItems();
            for (var i = 0; i < resultItems.length; i++) {
                var result = resultItems[i];

                if (result.type == 'expect' && result.passed && !result.passed()) {
                    failures += 1;
                    failure += (failures + ": " + escapeInvalidXmlChars(result.message) + " ");
                    UIALogger.logFail(result.message);
                }
            }
            if (failure) {
                spec.output += "<failure>" + trim(failure) + "</failure>";
                UIALogger.logFail(spec.description);
            } else {
                UIALogger.logPass(spec.description);
            }
            spec.output += "</testcase>";
        },

        reportSuiteResults: function(suite) {
            var results = suite.results();
            var specs = suite.specs();
            var specOutput = "";
            // for JUnit results, let's only include directly failed tests (not nested suites')
            var failedCount = 0;

            suite.status = results.passed() ? 'Passed.' : 'Failed.';
            if (results.totalCount === 0) { // todo: change this to check results.skipped
                suite.status = 'Skipped.';
            }

            // if a suite has no (active?) specs, reportSpecStarting is never called
            // and thus the suite has no startTime -- account for that here
            suite.startTime = suite.startTime || new Date();
            suite.duration = elapsed(suite.startTime, new Date());

            for (var i = 0; i < specs.length; i++) {
                failedCount += specs[i].didFail ? 1 : 0;
                specOutput += "\n  " + specs[i].output;
            }
            suite.output = '\n<testsuite name="' + this.getFullName(suite) +
                '" errors="0" tests="' + specs.length + '" failures="' + failedCount +
                '" time="' + suite.duration + '" timestamp="' + ISODateString(suite.startTime) + '">';
            suite.output += specOutput;
            suite.output += "\n</testsuite>";
        },

        reportRunnerResults: function(runner) {
            var suites = runner.suites();
            var output = '<?xml version="1.0" encoding="UTF-8" ?>';
            output += "\n<testsuites>";

            for (var i = 0; i < suites.length; i++) {
                var suite = suites[i];
                
                // if we are consolidating, only write out top-level suites
                if (this.consolidate && suite.parentSuite) {
                    continue;
                }
                else if (this.consolidate) {
                    output += this.getNestedOutput(suite);
                }
                else {
                    output += suite.output;
                }
            }
            output += "\n</testsuites>";
            UIALogger.logDebug("\n" + output);

            // When all done, make it known on JUnitXmlReporter
            JUnitXmlReporter.finished_at = (new Date()).getTime();
            
            this.writeFile("junit.xml", output);
        },

        getNestedOutput: function(suite) {
            var output = suite.output;
            for (var i = 0; i < suite.suites().length; i++) {
                output += this.getNestedOutput(suite.suites()[i]);
            }
            return output;
        },

        writeFile: function(filename, text) {
            // Rhino
            try {
                var out = new java.io.BufferedWriter(new java.io.FileWriter(filename));
                out.write(text);
                out.close();
                return;
            } catch (e) {}
            // PhantomJS, via a method injected by phantomjs-testrunner.js
            try {
                __phantom_writeFile(filename, text);
                return;
            } catch (f) {}
            // Node.js
            try {
                var fs = require("fs");
                var fd = fs.openSync(filename, "w");
                fs.writeSync(fd, text, 0);
                fs.closeSync(fd);
                return;
            } catch (g) {}

            // UIAutomation
            try {                
                var encoded = Base64.encode(text);
                var host = UIATarget.localTarget().host();
                var command = "echo "+encoded+" | base64 --decode -o junit.xml";
                // Note: this has a limitation of 262144 bytes (Mountain Lion bash) 
                // $ getconf ARG_MAX
                // 262144
                host.performTaskWithPathArgumentsTimeout("/bin/bash", ["-c", command], 5);                
            } catch (h) {
            	UIALogger.logDebug("Failed storing JUnit XML file");
            	UIALogger.logDebug(h);
            }
        },

        getFullName: function(suite, isFilename) {
            var fullName;
            if (this.useDotNotation) {
                fullName = suite.description;
                for (var parentSuite = suite.parentSuite; parentSuite; parentSuite = parentSuite.parentSuite) {
                    fullName = parentSuite.description + '.' + fullName;
                }
            }
            else {
                fullName = suite.getFullName();
            }

            // Either remove or escape invalid XML characters
            if (isFilename) {
                return fullName.replace(/[^\w]/g, "");
            }
            return escapeInvalidXmlChars(fullName);
        },

        log: function(str) {
            var console = jasmine.getGlobal().console;

            if (console && console.log) {
                console.log(str);
            }
        }
    };

    // export public
    jasmine.JUnitXmlReporter = JUnitXmlReporter;
})();
