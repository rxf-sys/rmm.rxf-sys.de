package main

import "io"

// closeQuietly closes c for callers that are done with it and could not act
// on a failure: everything they needed has already been read, or — for the
// agent socket — the session is over and the next dial starts from scratch.
// A failed Close there loses no data, so there is nothing to report.
func closeQuietly(c io.Closer) { _ = c.Close() }
