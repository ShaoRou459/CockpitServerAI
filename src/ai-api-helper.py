#!/usr/bin/env python3
"""
AI API Helper for Cockpit AI Agent

This script makes HTTP requests to AI APIs (OpenAI, Gemini, etc.)
and returns the response. It's called via cockpit.spawn() to bypass
Cockpit's CSP restrictions on external HTTP requests.

Usage:
    echo '{"url": "...", "method": "POST", "headers": {...}, "body": "..."}' | python3 ai-api-helper.py
"""

import sys
import json
import urllib.request
import urllib.error
import ssl

def main():
    try:
        # Read JSON input from stdin
        input_data = sys.stdin.read()
        request = json.loads(input_data)
        
        url = request.get('url')
        method = request.get('method', 'POST')
        headers = request.get('headers', {})
        body = request.get('body', '')
        
        if not url:
            print(json.dumps({'error': 'URL is required'}))
            sys.exit(1)
        
        # Create the request
        req = urllib.request.Request(
            url,
            data=body.encode('utf-8') if body else None,
            headers=headers,
            method=method
        )
        
        # Create SSL context (allow connections)
        ctx = ssl.create_default_context()
        
        try:
            # Make the request
            with urllib.request.urlopen(req, context=ctx, timeout=120) as response:
                response_body = response.read().decode('utf-8')
                result = {
                    'status': response.status,
                    'body': response_body
                }
                print(json.dumps(result))
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8') if e.fp else ''
            result = {
                'status': e.code,
                'body': error_body,
                'error': str(e)
            }
            print(json.dumps(result))
            sys.exit(0)  # Exit 0 so cockpit.spawn doesn't fail
        except urllib.error.URLError as e:
            result = {
                'error': f'Connection failed: {str(e.reason)}'
            }
            print(json.dumps(result))
            sys.exit(1)
            
    except json.JSONDecodeError as e:
        print(json.dumps({'error': f'Invalid JSON input: {str(e)}'}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({'error': f'Unexpected error: {str(e)}'}))
        sys.exit(1)

if __name__ == '__main__':
    main()
