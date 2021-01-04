flt-html
========

This library is a plugin for [@ficlabapp/flt](/ficlabapp/flt).

## Usage

```javascript
import { Document } from "@ficlabapp/flt";
import { HTMLRendererPlugin } from "@ficlabapp/flt-html";

// create a new document and register the plugin
let d = new Document();
d.use(HTMLRendererPlugin);

// render to HTML
var html = d.toHTML();
```
