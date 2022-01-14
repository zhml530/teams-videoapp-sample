 class WebglVideoFilter {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2');
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        this.initalized = false;
        this.program = null;
        this.textureY = null;
        this.textureUV = null;
        this.effectPixelBuffer = null;
    }
    
    init() {
        if (!this.initalized) {
            this._initProgram();
            this._initVertexBuffers();
            this._initTexture();
            this.initalized = true;
        }
    }

    processVideoFrame(videoFrame) {
        let gl = this.gl;
        let width = videoFrame.width;
        let height = videoFrame.height;
        this._setSize(width, height);
        gl.viewport(0, 0, this.canvasWidth, this.canvasHeight);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

 
        let uOffset = width * height;
        gl.bindTexture(gl.TEXTURE_2D, this.textureY);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.LUMINANCE,
            width,
            height,
            0,
            gl.LUMINANCE,
            gl.UNSIGNED_BYTE,
            videoFrame.data.subarray(0, uOffset)
        );

        gl.bindTexture(gl.TEXTURE_2D, this.textureUV);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.LUMINANCE_ALPHA,
            width >> 1,
            height >> 1,
            0,
            gl.LUMINANCE_ALPHA,
            gl.UNSIGNED_BYTE,
            videoFrame.data.subarray(uOffset, videoFrame.data.length)
        );

        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, this.effectPixelBuffer);

        // color alignment
        for (let i = 0; i < uOffset; i += 1) {
            videoFrame.data[i] = this.effectPixelBuffer[4 * i];
        }

        let widthIndex = 0;
        let curIndex = 0;
        for (let i = uOffset; i < videoFrame.data.length; i += 2) {
            videoFrame.data[i] = this.effectPixelBuffer[ 4 * curIndex + 1];
            videoFrame.data[i + 1] = this.effectPixelBuffer[4 * curIndex + 2];
            widthIndex += 2
            curIndex += 2
            if (widthIndex > videoFrame.width) {
                curIndex += videoFrame.width;
                widthIndex = widthIndex % videoFrame.width;
            }
        }
    }

    _setSize(width, height) {
        if (this.canvasWidth !== width || this.canvasHeight !== height) {
            // this.canvas.width = width;
            // this.canvas.height = height;
            this.canvasWidth = width;
            this.canvasHeight = height;
            this.effectPixelBuffer = new Uint8Array(width * height * 4)
        }
    }

    _initProgram() {
        const vertexShaderSource = `
            attribute vec4 a_vertexPosition;
            attribute vec2 a_texturePosition;
            varying vec2 v_texCoord;
            void main() {
                gl_Position = a_vertexPosition;
                v_texCoord = a_texturePosition;
            }
        `;
        const fragmentShaderSource = `
            precision mediump float; 
            varying vec2      v_texCoord; 
            uniform sampler2D u_samplerY; 
            uniform sampler2D u_samplerUV; 

            vec3 yuv2r = vec3(1.164, 0.0, 1.596);
            vec3 yuv2g = vec3(1.164, -0.391, -0.813);
            vec3 yuv2b = vec3(1.164, 2.018, 0.0);
            vec3 nv12_to_rgb(vec2 texCoord) {
                vec3 yuv; 
                yuv.x = texture2D(u_samplerY, texCoord).r - 0.0625;
                yuv.y = texture2D(u_samplerUV, texCoord).r - 0.5;
                yuv.z = texture2D(u_samplerUV, texCoord).a - 0.5;
                vec3 rgb = vec3(dot(yuv, yuv2r), dot(yuv, yuv2g), dot(yuv, yuv2b));
                return rgb; 
            }

            float V(vec3 c) {
                float result = (0.439 * c.r) - (0.368 * c.g) - (0.071 * c.b) + 0.5;
                return result;
            }

            float U(vec3 c) {
                float result = -(0.148 * c.r) - (0.291 * c.g) + (0.439 * c.b) + 0.5;
                return result; 
            }

            float Y(vec3 c) {
                float result = (0.257 * c.r) + (0.504 * c.g) + (0.098 * c.b) + 0.0625;
                return result;
            }

            void main() {
                gl_FragColor = vec4(nv12_to_rgb(v_texCoord), 1); 
                // gray effect
                float luminance = 0.299 * gl_FragColor.r + 0.587 * gl_FragColor.g + 0.114 * gl_FragColor.b;
                gl_FragColor = vec4(luminance, luminance, luminance, 5);

                // rgba to nv12
                gl_FragColor = vec4(Y(gl_FragColor.rgb), U(gl_FragColor.rgb), V(gl_FragColor.rgb), 1);
            }
        `;
        
        let gl = this.gl;
        let vertexShader = this._compileShader(vertexShaderSource, gl.VERTEX_SHADER);
        let fragmentShader = this._compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);

        let program = this.gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        gl.useProgram(program);
        let success = gl.getProgramParameter(program, gl.LINK_STATUS);
        if (!success) {
            console.error('program fail to link' + gl.getShaderInfoLog(program));
            return;
        }
        this.program = program;
    }

    _initVertexBuffers() {
        let vertices = new Float32Array([
            -1, -1, 0, 0.0,  0.0,
            1, -1, 0, 1.0,  0.0,
            -1, 1, 0, 0.0,  1.0,
            1, 1, 0, 1.0,  1.0,
         ]);

        let gl = this.gl;
        let program = this.program;
        let verticeBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, verticeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
        let positionLocation = gl.getAttribLocation(program, "a_vertexPosition");
        gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 5 * 4, 0);
        gl.enableVertexAttribArray(positionLocation);

        let indices = new Int16Array([
            0, 1, 2, 
            2, 1, 3
        ]);
        let indicesBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indicesBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
        let texcoordLocation = gl.getAttribLocation(program, "a_texturePosition");
        gl.vertexAttribPointer(texcoordLocation, 2, gl.FLOAT, false, 5 * 4, 3 * 4);
        gl.enableVertexAttribArray(texcoordLocation);
    }

    _createTexture() {
        let gl = this.gl;
        let texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
       
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        return texture;
    }

    _initTexture() {
        let gl = this.gl;
        let program = this.program;
        this.textureY = this._createTexture();
        gl.uniform1i(gl.getUniformLocation(program, 'u_textureY'), 0);

        gl.activeTexture(gl.TEXTURE1);
        this.textureUV = this._createTexture();
        gl.uniform1i(gl.getUniformLocation(program, 'u_textureUV'), 1);
    }

    _compileShader(shaderSource, shaderType) {
        let gl = this.gl;
        let shader = gl.createShader(shaderType);
        gl.shaderSource(shader, shaderSource);
        gl.compileShader(shader);
        let success = gl.getShaderParameter(shader, this.gl.COMPILE_STATUS);
        if (!success) {
            let err = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            console.error('could not compile shader', err);
            return;
        }
        return shader;
    }
}
