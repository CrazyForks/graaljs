/*
 * Copyright (c) 2018, 2024, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * The Universal Permissive License (UPL), Version 1.0
 *
 * Subject to the condition set forth below, permission is hereby granted to any
 * person obtaining a copy of this software, associated documentation and/or
 * data (collectively the "Software"), free of charge and under any and all
 * copyright rights in the Software, and any and all patent rights owned or
 * freely licensable by each licensor hereunder covering either (i) the
 * unmodified Software as contributed to or provided by such licensor, or (ii)
 * the Larger Works (as defined below), to deal in both
 *
 * (a) the Software, and
 *
 * (b) any piece of software and/or hardware listed in the lrgrwrks.txt file if
 * one is included with the Software each a "Larger Work" to which the Software
 * is contributed by such licensors),
 *
 * without restriction, including without limitation the rights to copy, create
 * derivative works of, display, perform, and distribute the Software and make,
 * use, sell, offer for sale, import, export, have made, and have sold the
 * Software and the Larger Work(s), and to sublicense the foregoing rights on
 * either these or other terms.
 *
 * This license is subject to the following condition:
 *
 * The above copyright notice and either this complete permission notice or at a
 * minimum a reference to the UPL must be included in all copies or substantial
 * portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
package com.oracle.truffle.js.runtime.util;

import com.oracle.truffle.api.CompilerAsserts;
import com.oracle.truffle.api.CompilerDirectives;
import com.oracle.truffle.api.CompilerDirectives.CompilationFinal;
import com.oracle.truffle.api.dsl.NeverDefault;
import com.oracle.truffle.api.nodes.NodeCloneable;
import com.oracle.truffle.js.runtime.builtins.JSClass;
import com.oracle.truffle.js.runtime.objects.JSDynamicObject;
import com.oracle.truffle.js.runtime.objects.JSShape;

public abstract class JSClassProfile extends NodeCloneable {
    JSClassProfile() {
    }

    @NeverDefault
    public static JSClassProfile create() {
        return new JSClassProfile.Cached();
    }

    @NeverDefault
    public static JSClassProfile getUncached() {
        return UNCACHED;
    }

    public JSClass getJSClass(JSDynamicObject jsobject) {
        return (JSClass) JSShape.getJSClassNoCast(jsobject.getShape());
    }

    public JSClass profile(JSClass jsobjectClass) {
        return jsobjectClass;
    }

    private static final class Cached extends JSClassProfile {
        @CompilationFinal private JSClass expectedJSClass;
        @CompilationFinal private boolean polymorphicJSClass;

        @Override
        public JSClass getJSClass(JSDynamicObject jsobject) {
            Object jsobjectClass = JSShape.getJSClassNoCast(jsobject.getShape());
            if (!polymorphicJSClass) {
                if (jsobjectClass == expectedJSClass) {
                    return expectedJSClass;
                } else {
                    CompilerDirectives.transferToInterpreterAndInvalidate();
                    if (expectedJSClass == null) {
                        expectedJSClass = (JSClass) jsobjectClass;
                    } else {
                        polymorphicJSClass = true;
                    }
                }
            }
            return (JSClass) jsobjectClass;
        }

        @Override
        public JSClass profile(JSClass jsobjectClass) {
            if (!polymorphicJSClass) {
                if (jsobjectClass == expectedJSClass) {
                    return expectedJSClass;
                } else {
                    CompilerDirectives.transferToInterpreterAndInvalidate();
                    if (expectedJSClass == null) {
                        expectedJSClass = jsobjectClass;
                    } else {
                        polymorphicJSClass = true;
                    }
                }
            }
            return jsobjectClass;
        }

        @Override
        public String toString() {
            CompilerAsserts.neverPartOfCompilation();
            return "JSClass(" + (polymorphicJSClass ? "polymorphic" : String.valueOf(expectedJSClass)) + ")";
        }
    }

    private static final JSClassProfile UNCACHED = new JSClassProfile() {
        @Override
        public String toString() {
            return "JSClass(uncached)";
        }
    };
}
