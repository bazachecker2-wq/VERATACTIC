
/*
Heightmap.js is a simple utility for generating procedural heightmaps.
It's designed to be used in browser environments, providing a global 'Heightmap' object.
*/

(function() {
    const Heightmap = {
        /**
         * Generates a heightmap using Perlin noise.
         * @param {object} options - Configuration options.
         * @param {number} options.width - Width of the heightmap grid.
         * @param {number} options.height - Height of the heightmap grid.
         * @param {number} [options.scale=32] - Scale of the Perlin noise (frequency).
         * @param {number} [options.octaves=4] - Number of noise layers for detail.
         * @param {number} [options.persistence=0.5] - How much each octave contributes to the total.
         * @param {number} [options.lacunarity=2] - Frequency multiplier for each octave.
         * @param {number} [options.seed=Math.random()] - Seed for the random number generator.
         * @param {number} [options.maxHeight=10] - Maximum height value in the map.
         * @param {number} [options.minHeight=0] - Minimum height value in the map.
         * @param {number} [options.smootheningIterations=0] - Number of iterations for a simple box blur.
         * @returns {number[][]} A 2D array representing the heightmap.
         */
        generate: function(options) {
            options = {
                width: 64,
                height: 64,
                scale: 32,
                octaves: 4,
                persistence: 0.5,
                lacunarity: 2,
                seed: Math.random(),
                maxHeight: 10,
                minHeight: 0,
                smootheningIterations: 0,
                ...options
            };

            const perlin = this._createPerlin(options.seed);
            const heightmap = [];
            let minVal = Infinity;
            let maxVal = -Infinity;

            for (let y = 0; y < options.height; y++) {
                heightmap[y] = [];
                for (let x = 0; x < options.width; x++) {
                    let amplitude = 1;
                    let frequency = 1;
                    let noiseHeight = 0;

                    for (let i = 0; i < options.octaves; i++) {
                        const sampleX = (x - options.width / 2) / options.scale * frequency;
                        const sampleY = (y - options.height / 2) / options.scale * frequency;

                        const perlinValue = perlin.noise(sampleX, sampleY, 0);
                        noiseHeight += perlinValue * amplitude;

                        amplitude *= options.persistence;
                        frequency *= options.lacunarity;
                    }

                    heightmap[y][x] = noiseHeight;
                    minVal = Math.min(minVal, noiseHeight);
                    maxVal = Math.max(maxVal, noiseHeight);
                }
            }

            // Normalize and scale to minHeight/maxHeight
            for (let y = 0; y < options.height; y++) {
                for (let x = 0; x < options.width; x++) {
                    const normalizedHeight = (heightmap[y][x] - minVal) / (maxVal - minVal);
                    heightmap[y][x] = options.minHeight + normalizedHeight * (options.maxHeight - options.minHeight);
                }
            }

            // Apply smoothening
            for (let i = 0; i < options.smootheningIterations; i++) {
                this._smoothenHeightmap(heightmap, options.width, options.height);
            }

            return heightmap;
        },

        // Simple Perlin noise implementation (based on https://github.com/josephg/noisejs)
        _createPerlin: function(seed) {
            const F2 = 0.5 * (Math.sqrt(3) - 1);
            const G2 = (3 - Math.sqrt(3)) / 6;

            let grad2d = [
                [1, 1], [-1, 1], [1, -1], [-1, -1],
                [1, 0], [-1, 0], [0, 1], [0, -1]
            ];

            let p = new Array(256);
            let perm = new Array(512);
            let gradP = new Array(512);

            this._seedRandom(seed);
            for (let i = 0; i < 256; i++) p[i] = i;
            this._shuffleArray(p);

            for (let i = 0; i < 512; i++) {
                perm[i] = p[i & 255];
                gradP[i] = grad2d[perm[i] % 8];
            }

            function dot(g, x, y) {
                return g[0] * x + g[1] * y;
            }

            function fade(t) {
                return t * t * t * (t * (t * 6 - 15) + 10);
            }

            return {
                noise: function(x, y) {
                    let s = (x + y) * F2;
                    let i = Math.floor(x + s);
                    let j = Math.floor(y + s);

                    let t = (i + j) * G2;
                    let X0 = i - t;
                    let Y0 = j - t;

                    let x0 = x - X0;
                    let y0 = y - Y0;

                    let i1, j1;
                    if (x0 > y0) {
                        i1 = 1;
                        j1 = 0;
                    } else {
                        i1 = 0;
                        j1 = 1;
                    }

                    let x1 = x0 - i1 + G2;
                    let y1 = y0 - j1 + G2;
                    let x2 = x0 - 1 + 2 * G2;
                    let y2 = y0 - 1 + 2 * G2;

                    let ii = i & 255;
                    let jj = j & 255;

                    let t0 = 0.5 - x0 * x0 - y0 * y0;
                    let n0;
                    if (t0 < 0) n0 = 0;
                    else {
                        t0 *= t0;
                        n0 = t0 * t0 * dot(gradP[ii + perm[jj]], x0, y0);
                    }

                    let t1 = 0.5 - x1 * x1 - y1 * y1;
                    let n1;
                    if (t1 < 0) n1 = 0;
                    else {
                        t1 *= t1;
                        n1 = t1 * t1 * dot(gradP[ii + i1 + perm[jj + j1]], x1, y1);
                    }

                    let t2 = 0.5 - x2 * x2 - y2 * y2;
                    let n2;
                    if (t2 < 0) n2 = 0;
                    else {
                        t2 *= t2;
                        n2 = t2 * t2 * dot(gradP[ii + 1 + perm[jj + 1]], x2, y2);
                    }
                    return 40 * (n0 + n1 + n2);
                }
            };
        },

        _seedRandom: function(seed) {
            let _seed = seed;
            this._rand = function() {
                _seed = (_seed * 9301 + 49297) % 233280;
                return _seed / 233280;
            };
        },

        _shuffleArray: function(array) {
            let currentIndex = array.length, randomIndex;
            while (currentIndex !== 0) {
                randomIndex = Math.floor(this._rand() * currentIndex);
                currentIndex--;
                [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
            }
            return array;
        },

        _smoothenHeightmap: function(heightmap, width, height) {
            const newHeightmap = JSON.parse(JSON.stringify(heightmap)); // Deep copy
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    let sum = 0;
                    let count = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nx = x + dx;
                            const ny = y + dy;
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                sum += heightmap[ny][nx];
                                count++;
                            }
                        }
                    }
                    newHeightmap[y][x] = sum / count;
                }
            }
            // Overwrite original with smoothed version
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    heightmap[y][x] = newHeightmap[y][x];
                }
            }
        }
    };

    if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
        module.exports = Heightmap;
    } else {
        window.Heightmap = Heightmap;
    }
})();
