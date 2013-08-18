# HackerDNS - backend

HackerDNS is a DNS server written in node.js, current repository is a complete
bockend for it, consisting of both DNS and API servers.

## How to run

1. Install and start couchdb and redis servers.
2. Copy `config-sample.json` to `config.json` and change configuration
   according to your setup.
3. Start HackerDNS backend with one of following commands:

    node app.js  # to run both dns and api server
    node app.js api  # to run only api server
    node app.js dns  # to run only dns server

4. Install and run [frontend][0]
5. Use it!

## API

### Signup and login

    POST /signup { "email": "user@email.com", "password": "password" }

Returns:

    { "ok": true, "token": "your-auth-token" }

Requests to all other API methods will require either `token` in body, or in
http header `X-HackerDNS-Token` (case-insensitive). Therefore `token` field in
body in all methods below is optional, if present in headers.

### Logout

    POST /logout { "token": "your-auth-token" }

Returns:

    { "ok": true }

### Get all domains and records

    GET /dns

Returns:

    [ {
        "domain": "example.com",
        "records": [{
          "sub": "sub.domain",
          "type": "A",
          "data": "1.2.3.4",
          "ttl": 9000
        },
        ...
        ]
      },
      ...
    ]

### Get all domain's records

    GET /dns/:domain

Returns - same as above, but one object (not array).


### Add new records

    POST /dns
    {
      "token": "...",
      "domain": "example.com",
      "records": [{ /* format as above */ }]
    }

Returns

    { "ok": true }

### Remove records

    POST /dns
    {
      "token": "...",
      "domain": "example.com",
      "records": [{ /* format as above */ }]
    }

Returns

    { "ok": true }


#### LICENSE

This software is licensed under the MIT License.

Copyright Fedor Indutny, 2013.

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.

[0]: https://github.com/indutny/hackerdns.frontend
