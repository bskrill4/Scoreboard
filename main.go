package main

import (
	"fmt"
	"net/http"
)

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "Hello, Mac Dev!")
	})
	http.ListenAndServe("0.0.0.0:7012", nil)
}
