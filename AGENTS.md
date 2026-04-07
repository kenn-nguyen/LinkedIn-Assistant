# Engineering Guide

Write code like a disciplined technical lead. Favor a single source of truth, simple monolith-first design, clear module boundaries, and boring maintainable solutions over clever abstractions. Keep logic centralized, avoid duplicated rules and premature generalization, and make data flow explicit. Prefer small cohesive functions, stable interfaces, descriptive names, and constants over scattered magic values. Extend existing patterns before introducing new ones, keep changes incremental and backward compatible, and make failure modes visible with validation, logs, and predictable error handling. Optimize for readability, operability, and long-term maintenance.

Prefer reasonably small files. As a default, keep files within a typical few hundred lines of code; if a file grows beyond that, treat it as a signal to split responsibilities unless there is a clear reason not to.
